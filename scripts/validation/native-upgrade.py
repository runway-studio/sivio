#!/usr/bin/env python3
"""Real native upgrade on a disposable GitHub macOS runner; never a personal Mac."""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import sqlite3
import struct
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/release'))
from sign import identity, probe_identity
from version import set_version, from_tag
from privacy import Scanner
from publish import verify_local


def call(args, **kw):
    return subprocess.check_output([str(a) for a in args], **kw)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def events(path):
    if not path.exists(): return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def process_ids(binary):
    rows = call(['ps', '-axo', 'pid=,command=']).decode().splitlines()
    return [int(row.strip().split(None, 1)[0]) for row in rows
            if len(row.strip().split(None, 1)) == 2 and row.strip().split(None, 1)[1].split(' --', 1)[0] == str(binary)]


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--tag', required=True); args = parser.parse_args()
    version = from_tag(args.tag)
    if os.environ.get('GITHUB_ACTIONS') != 'true' or sys.platform != 'darwin' or '-rc.' not in version:
        raise SystemExit('Only disposable macOS GitHub runners and a test prerelease are supported')
    work = Path(os.environ['RUNNER_TEMP']) / 'sivio-native-upgrade'
    work.mkdir(mode=0o700)
    assets = work / 'target'; assets.mkdir()
    repo = 'runway-studio/sivio'
    call(['gh', 'release', 'download', args.tag, '--repo', repo, '--dir', assets])
    Scanner().artifacts(assets).require_clean()
    evidence = json.loads((assets / 'release-evidence.json').read_text())
    config = json.loads((ROOT / 'app/src-tauri/release-config.json').read_text())
    env = {**os.environ, 'CARGO_HOME': str(ROOT / 'build/cache/cargo')}
    subprocess.run(['cargo', '+1.99.0', 'build', '--locked', '--manifest-path', 'scripts/release/verifier/Cargo.toml'], cwd=ROOT, env=env, check=True)
    verify_local(assets, args.tag, evidence['sourceSha'], config)
    subprocess.run(['pnpm', '--dir', 'app', 'install', '--frozen-lockfile'], cwd=ROOT, check=True)
    for channel in ('stable', 'alpha'):
        subprocess.run([sys.executable, 'scripts/fetch-mihomo.py', '--arch', 'aarch64-apple-darwin', '--channel', channel], cwd=ROOT, check=True)
    result = {'targetVersion': version, 'targetSourceSha': evidence['sourceSha'], 'testHostVersion': '0.1.0',
              'testHost': 'same production backend with a compile-time CI driver', 'status': 'failed'}
    output = ROOT / 'build/reports/native-upgrade.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    binary = None
    installer = None
    event_file = work / 'events.jsonl'
    try:
        with identity() as (fingerprint, keychain):
            probe_identity(fingerprint, keychain)
            env.update(SIVIO_CODESIGN_IDENTITY=fingerprint, SIVIO_CODESIGN_KEYCHAIN=keychain)
            set_version('0.1.0')
            try:
                subprocess.run([sys.executable, 'scripts/build-app.py', '--arch', 'aarch64', '--upgrade-validation'], cwd=ROOT, env=env, check=True)
            finally:
                set_version(version)
            report = json.loads((ROOT / 'build/reports/app-aarch64-artifact.json').read_text())
            assert report['validationDriver'] is True
            app = work / 'Sivio.app'
            shutil.copytree(ROOT / report['app'], app)
            binary = app / 'Contents/MacOS/sivio-desktop'
            old_hash = sha(binary)
            call(['codesign', '--verify', '--deep', '--strict', app])
            network = app / 'Contents/Resources/network'
            payload = lzma.decompress((network / 'mihomo-cores.xz').read_bytes())
            assert payload[:8] == b'SIVCORE1'
            size, _ = struct.unpack('<QQ', payload[8:24])
            core = work / 'verge-mihomo'; core.write_bytes(payload[24:24 + size]); core.chmod(0o755)
            # Register the production App's stable signer, plus only this test
            # control client's hash. No relaxed helper authentication.
            control = network / 'si-helper-control'
            details = subprocess.run(['codesign', '-d', '--verbose=4', str(control)], capture_output=True, text=True, check=True).stderr
            control_hash = re.search(r'^CDHash=(\w+)$', details, re.M)[1]
            observer = work / 'observer-control'; shutil.copy2(control, observer)
            installer = network / 'clash-verge-service-uninstall'
            call(['sudo', '-n', network / 'clash-verge-service-install', '--install-service', '--install-core', core,
                  '--sha256', sha(core), '--client-signer', fingerprint, '--client-cdhash', control_hash])
            app_env = {k: v for k, v in os.environ.items() if not any(word in k for word in ('TOKEN', 'PASSWORD', 'PRIVATE_KEY', 'SIGNING_KEYCHAIN', 'CERTIFICATE_P12'))}
            # Runner home is disposable and shared with LaunchServices restart.
            # No HOME override and no access to a developer's profile.
            app_env.pop('CC_SWITCH_TEST_HOME', None)
            app_env.update(SIVIO_NATIVE_UPGRADE_PROBE=str(event_file), SIVIO_NATIVE_UPGRADE_FEED=f'https://github.com/{repo}/releases/download/{args.tag}/latest.json')
            ai = Path.home() / 'Library/Application Support/SI Assist/ai'
            network_root = ai.parent / 'network'
            assert not (ai / 'cc-switch.db').exists(), 'runner already contains app data'
            with (work / 'native-output.txt').open('wb') as log:
                process = subprocess.Popen([str(binary)], env=app_env, stdout=log, stderr=subprocess.STDOUT)
                deadline = time.monotonic() + 300
                preference_hash = None
                old_core_pid = None
                while time.monotonic() < deadline and process.poll() is None:
                    observed = events(event_file)
                    if any(e['stage'] == 'error' for e in observed): raise RuntimeError('Native driver failed; inspect local runner events')
                    if preference_hash is None and any(e['stage'] == 'before-upgrade' for e in observed):
                        preference_hash = sha(ai / 'settings.json')
                        status = json.loads(call([observer, 'status'], env={**app_env, 'SI_VALIDATION_ROOT': str(network_root)}))
                        assert status['code'] == 0 and status['data']['is_active']
                        old_core_pid = status['data']['core_pid']
                    time.sleep(0.5)
                if process.poll() is None: raise RuntimeError('Native upgrade timed out')
                assert process.returncode == 0, 'old native process failed'
            observed = events(event_file)
            for stage in ('failed-check-preserved-app', 'before-upgrade', 'candidate', 'verified-download', 'tampered-signature-rejected'):
                assert any(e['stage'] == stage for e in observed), stage
            assert any(e.get('progress') == 'restarting' for e in observed)
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            assert info['CFBundleShortVersionString'] == version
            new_hash = sha(binary); assert new_hash != old_hash
            call(['codesign', '--verify', '--deep', '--strict', '--test-requirement', '=certificate leaf = H"' + fingerprint + '"', app])
            # Wait for the normal, uninstrumented target app to reopen and resume
            # its encrypted network profile with the same signer/Keychain access.
            deadline = time.monotonic() + 90
            proxy = urllib.request.build_opener(urllib.request.ProxyHandler({'https': 'http://127.0.0.1:17890'}))
            new_pids = []
            while time.monotonic() < deadline:
                new_pids = process_ids(binary)
                try:
                    if not new_pids: raise RuntimeError('not restarted')
                    with proxy.open('https://example.com', timeout=5) as response:
                        if response.status != 200: raise RuntimeError('proxy response')
                    break
                except Exception:
                    time.sleep(1)
            else: raise RuntimeError('New native app/network did not recover')
            assert process.pid not in new_pids
            status = json.loads(call([observer, 'status'], env={**app_env, 'SI_VALIDATION_ROOT': str(network_root)}))
            assert status['code'] == 0 and status['data']['is_active']
            assert old_core_pid and status['data']['core_pid'] != old_core_pid
            connection = sqlite3.connect(ai / 'cc-switch.db')
            assert connection.execute('SELECT value FROM settings WHERE key=?', ('native_upgrade_validation',)).fetchone()[0] == 'synthetic-retained-record'
            connection.close()
            assert preference_hash and sha(ai / 'settings.json') == preference_hash
            backups = list(work.glob('.sivio-update-*/previous.app'))
            assert len(backups) == 1 and sha(backups[0] / 'Contents/MacOS/sivio-desktop') == old_hash
            result.update(status='passed', oldPid=process.pid, newPids=new_pids, oldExecutableSha256=old_hash, newExecutableSha256=new_hash,
                installerSha256=sha(assets / f'Sivio-{version}-aarch64.zip'), signatureIdentity=fingerprint,
                databaseRecordPreserved=True, preferencesBytesPreserved=True, previousBundleRetained=True,
                oldCorePid=old_core_pid, newCorePid=status['data']['core_pid'],
                nativeRestart=True, managedNetworkResumed=True, httpsThroughResumedProxy=True,
                helperSignerAcceptedBefore=True, helperSignerAcceptedAfter='inferred from successful managed-network recovery without reinstallation',
                failedHttpCheckPreservedApp=True, tamperedSignatureRejectedWithoutStoppingNetwork=True,
                limits=['UI clicking/unsaved-edit prompts are covered separately, not driven by this native harness.', 'TUN mode is not exercised; this run uses managed system proxy.'])
    finally:
        result['driverEvents'] = events(event_file)
        output.write_text(json.dumps(result, indent=2) + '\n')
        if binary:
            for pid in process_ids(binary):
                try: os.kill(pid, signal.SIGTERM)
                except ProcessLookupError: pass
        if installer and installer.exists():
            subprocess.run(['sudo', '-n', str(installer)], capture_output=True)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
