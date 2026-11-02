"""Build only the approved Apple Silicon release from a clean tag checkout."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from version import ROOT, check
from sign import identity


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    parser.add_argument('--validate-only', action='store_true', help='Validate a clean commit without requiring or creating its version tag')
    args = parser.parse_args()
    check(args.tag)
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    tagged = head if args.validate_only else subprocess.check_output(['git', 'rev-parse', args.tag + '^{commit}'], cwd=ROOT, text=True).strip()
    if head != tagged or subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=normal'], cwd=ROOT):
        raise SystemExit('Release requires a clean checkout of the exact tag commit')
    config = json.loads((ROOT / 'app/src-tauri/release-config.json').read_text())
    if not config['publicKey'] or config['signingMode'] != 'internal':
        raise SystemExit('Configure the official public key and stable internal signing first')
    if not (os.environ.get('TAURI_SIGNING_PRIVATE_KEY') or os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PATH')):
        raise SystemExit('Missing update signing private key')
    (ROOT / 'build/reports').mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'CARGO_HOME': str(ROOT / 'build/cache/cargo')}
    subprocess.run(['pnpm', '--dir', 'app', 'install', '--frozen-lockfile'], cwd=ROOT, env=env, check=True)
    subprocess.run(['cargo', '+1.99.0', 'build', '--locked', '--manifest-path', 'scripts/release/verifier/Cargo.toml'], cwd=ROOT, env=env, check=True)
    for channel in ['stable', 'alpha']:
        subprocess.run([sys.executable, 'scripts/fetch-mihomo.py', '--arch', 'aarch64-apple-darwin', '--channel', channel], cwd=ROOT, check=True)
    with identity() as (fingerprint, keychain):
        env.update(SIVIO_CODESIGN_IDENTITY=fingerprint, SIVIO_CODESIGN_KEYCHAIN=keychain)
        subprocess.run([sys.executable, 'scripts/build-app.py', '--arch', 'aarch64', '--release-distribution'], cwd=ROOT, env=env, check=True)
    if subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT):
        raise SystemExit('Build changed tracked source; refusing publication')


if __name__ == '__main__':
    main()
