#!/usr/bin/env python3
"""No signing keys/certificates: DMG copy and privileged-helper smoke on CI only.

This checks native behavior after a user's manual approval, NOT Gatekeeper
approval or the interactive administrator prompt. It never disables Gatekeeper.
"""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import re
import subprocess
import struct
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/release'))
from dmg import verify_dmg


def call(args, **kwargs):
    return subprocess.check_output([str(a) for a in args], stderr=subprocess.STDOUT, timeout=90, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin' or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Privileged smoke is restricted to disposable GitHub macOS runners')
    if any(k.startswith(('SIVIO_CODESIGN', 'SIVIO_SIGNING', 'SIVIO_CERTIFICATE', 'TAURI_SIGNING')) for k in os.environ):
        raise SystemExit('Consumer job must not receive signing credentials')
    report = {'version': args.version, 'status': 'failed', 'developerCertificateImported': False,
              'interactiveAuthorization': 'NOT_VERIFIED', 'gatekeeperBypassed': False,
              'scope': 'native helper smoke after manual approval; not interactive first launch'}
    output = ROOT / 'build/reports/dmg-consumer.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sivio-consumer-', dir=os.environ['RUNNER_TEMP']) as directory:
        work = Path(directory)
        mount = work / 'volume'
        installed = Path('/Applications/Sivio.app')
        helper_installed = False
        attached = False
        try:
            assert not installed.exists(), 'Runner already has Sivio'
            assert not (Path.home() / 'Library/Application Support/SI Assist').exists(), 'Runner has Sivio data'
            assert not Path('/Library/PrivilegedHelperTools/local.siassist.desktop.service.bundle').exists(), 'Runner has helper'
            inventory = call(['security', 'find-certificate', '-a', '-Z']).decode()
            assert '7795147A635CFD950B608FCA8C09E59554AFB0C2' not in inventory.upper(), 'Runner has developer certificate'
            image = args.assets / f'Sivio-{args.version}-aarch64.dmg'
            report['dmg'] = verify_dmg(image, args.version)
            call(['hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, image])
            attached = True
            call(['ditto', mount / 'Sivio.app', installed])
            call(['hdiutil', 'detach', mount]); attached = False
            call(['codesign', '--verify', '--deep', '--strict', installed])
            report['copiedToApplicationsSignatureValid'] = True
            gate = subprocess.run(['spctl', '--assess', '--type', 'execute', '--verbose=2', str(installed)], capture_output=True, text=True)
            report['gatekeeper'] = {'exitCode': gate.returncode, 'diagnostic': gate.stderr.strip(),
                                    'expectedForInternalSigning': 'manual approval required'}
            network = installed / 'Contents/Resources/network'
            control = network / 'si-helper-control'
            details = call(['codesign', '-d', '--verbose=4', control]).decode()
            control_hash = re.search(r'^CDHash=(\w+)$', details, re.M)[1]
            app_details = call(['codesign', '-d', '--verbose=4', installed]).decode()
            app_hash = re.search(r'^CDHash=(\w+)$', app_details, re.M)[1]
            payload = lzma.decompress((network / 'mihomo-cores.xz').read_bytes())
            assert payload[:8] == b'SIVCORE1'
            size, _ = struct.unpack('<QQ', payload[8:24])
            core = work / 'verge-mihomo'; core.write_bytes(payload[24:24 + size]); core.chmod(0o755)
            # The same elevated installer used after the desktop's system prompt.
            # Pin this exact shipped diagnostic client's hash; never re-sign it.
            helper_installed = True
            call(['sudo', '-n', network / 'clash-verge-service-install', '--install-service',
                  '--install-core', core, '--sha256', hashlib.sha256(core.read_bytes()).hexdigest(),
                  '--client-cdhash', app_hash, '--client-cdhash', control_hash])
            env = {**os.environ, 'SI_VALIDATION_ROOT': str(work / 'owner')}
            status = json.loads(call([control, 'status'], env=env))
            assert status['code'] == 0, status.get('message')
            report['freshHelperAcceptsShippedClient'] = True
            config = work / 'config.yaml'
            config.write_text('mixed-port: 15782\nbind-address: 127.0.0.1\nallow-lan: false\nmode: rule\ndns: {enable: false}\ntun: {enable: false}\nrules: ["MATCH,DIRECT"]\n')
            call([control, 'start', config], env=env)
            call([control, 'renew'], env=env)
            proxy = urllib.request.build_opener(urllib.request.ProxyHandler({'https': 'http://127.0.0.1:15782'}))
            with proxy.open('https://example.com', timeout=30) as response:
                assert response.status == 200
                report['httpsThroughManagedCore'] = response.status
            call([control, 'watch', '35'], env=env)
            call([control, 'stop'], env=env)
            report.update(status='passed', leaseRenewalSeconds=35, stoppedCleanly=True)
        except Exception as error:
            if isinstance(error, subprocess.CalledProcessError):
                report['error'] = error.output.decode(errors='replace')[-3000:]
            else:
                report['error'] = str(error)
        finally:
            if attached:
                subprocess.run(['hdiutil', 'detach', str(mount)], capture_output=True)
            if helper_installed:
                cleanup = subprocess.run(['sudo', '-n', str(installed / 'Contents/Resources/network/clash-verge-service-uninstall')], capture_output=True, timeout=90)
                report['helperCleanupExitCode'] = cleanup.returncode
                if cleanup.returncode:
                    report['status'] = 'failed'
            output.write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
