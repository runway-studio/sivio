#!/usr/bin/env python3
"""Assess the public installer on a disposable Mac without developer credentials.

Never removes quarantine, imports certificates, changes trust, or preinstalls a
helper. Passing this prerequisite does not substitute for interactive onboarding.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
REPO = 'runway-studio/sivio'
SIGNER = '7795147A635CFD950B608FCA8C09E59554AFB0C2'


def run(args, timeout=60):
    try:
        result = subprocess.run([str(a) for a in args], capture_output=True,
                                text=True, timeout=timeout, env={**os.environ, 'LC_ALL': 'C'})
        return {'exitCode': result.returncode,
                'stdout': result.stdout[-4000:], 'stderr': result.stderr[-4000:]}
    except subprocess.TimeoutExpired:
        return {'exitCode': None, 'stderr': 'timed out'}


def download(url, destination):
    request = urllib.request.Request(url, headers={'User-Agent': 'Sivio-first-install-validation'})
    with urllib.request.urlopen(request, timeout=90) as response:
        destination.write_bytes(response.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-rc\.\d+)?', args.tag):
        raise SystemExit('Invalid release tag')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise SystemExit('Requires a disposable GitHub macOS ARM64 runner')
    forbidden = [key for key in os.environ if any(word in key for word in
                 ('SIVIO_CODESIGN', 'SIVIO_SIGNING', 'SIVIO_CERTIFICATE', 'TAURI_SIGNING', 'APPLE_ID', 'APPLE_API_KEY'))]
    if forbidden:
        raise SystemExit('Signing credentials must not be supplied to consumer validation')
    work = Path(os.environ['RUNNER_TEMP']) / ('sivio-first-install-' + uuid.uuid4().hex)
    work.mkdir(mode=0o700)
    report_path = ROOT / 'build/reports/first-install.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report = {'tag': args.tag, 'status': 'failed', 'platform': platform.platform(),
              'signingCredentialsSupplied': False, 'quarantineRemoved': False,
              'interactiveFirstLaunch': 'NOT_VERIFIED', 'helperAuthorization': 'NOT_VERIFIED',
              'networkConnectivity': 'NOT_VERIFIED', 'steps': {}}
    steps = report['steps']
    try:
        data = Path.home() / 'Library/Application Support/SI Assist'
        helper = Path('/Library/PrivilegedHelperTools/local.siassist.desktop.service.bundle')
        assert not data.exists() and not helper.exists(), 'Runner contains pre-existing Sivio state'
        certificates = run(['security', 'find-certificate', '-a', '-Z'])
        assert certificates['exitCode'] == 0, 'Cannot inspect certificate discovery'
        # Inspect full output, never persist the runner certificate inventory.
        inventory = subprocess.check_output(['security', 'find-certificate', '-a', '-Z'], text=True)
        assert SIGNER not in inventory.upper(), 'Sivio signer already installed on runner'
        steps['cleanEnvironment'] = {'passed': True, 'appDataAbsent': True,
                                     'helperAbsent': True, 'signerAbsent': True}
        version = args.tag.removeprefix('v')
        name = f'Sivio-{version}-aarch64.zip'
        base = f'https://github.com/{REPO}/releases/download/{args.tag}/'
        archive, sums = work / name, work / 'SHA256SUMS'
        download(base + 'SHA256SUMS', sums)
        download(base + name, archive)
        entries = dict((row.split()[1].lstrip('*'), row.split()[0])
                       for row in sums.read_text().splitlines() if row.strip())
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        assert digest == entries[name], 'Downloaded ZIP digest differs from published checksum'
        steps['anonymousDownload'] = {'passed': True, 'sha256': digest, 'url': base + name}
        extraction = run(['ditto', '-x', '-k', archive, work / 'extracted'])
        assert extraction['exitCode'] == 0, 'Could not extract installer ZIP'
        app = work / 'extracted/Sivio.app'
        details = run(['codesign', '-d', '--verbose=4', app])
        steps['signatureDetails'] = details
        steps['strictSignature'] = run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])
        quarantine = f'0083;{int(time.time()):x};SivioFirstInstallValidation;{uuid.uuid4()}'
        marked = run(['xattr', '-wr', 'com.apple.quarantine', quarantine, app])
        assert marked['exitCode'] == 0, 'Could not reproduce a quarantined browser download'
        steps['downloadQuarantine'] = run(['xattr', '-p', 'com.apple.quarantine', app])
        steps['gatekeeper'] = run(['spctl', '--assess', '--type', 'execute', '--verbose=4', app], timeout=120)
        steps['notarizationTicket'] = run(['xcrun', 'stapler', 'validate', app], timeout=120)
        checks = ['strictSignature', 'gatekeeper', 'notarizationTicket']
        failures = [name for name in checks if steps[name]['exitCode'] != 0]
        report['blockingChecks'] = failures
        report['status'] = 'blocked' if failures else 'prerequisites-passed-onboarding-not-verified'
        # Do not bypass failed trust checks to create a misleading success result.
        if failures:
            raise RuntimeError('Public first-install prerequisites failed: ' + ', '.join(failures))
    except Exception as error:
        report['error'] = str(error)
    finally:
        # No user credentials, signing key material, or source-machine paths.
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
    return 1 if report['status'] in ('failed', 'blocked') else 0


if __name__ == '__main__':
    sys.exit(main())
