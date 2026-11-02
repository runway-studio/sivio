"""Install the existing Sivio signing identities in its configured GitHub repo.

Never prints secret contents. Requires a working gh login and the existing local
dedicated signing cache. This does not generate/rotate identities or publish.
"""
import base64
import argparse
import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path
from version import ROOT


def run(args, data=None):
    result = subprocess.run([str(x) for x in args], input=data, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{Path(str(args[0])).name} failed; check login/access and the existing identity (secret output withheld)')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keychain-snapshot', action='store_true', help='Use only the dedicated Sivio encrypted keychain instead of interactive P12 export')
    args = parser.parse_args()
    config = json.loads((ROOT / 'app/src-tauri/release-config.json').read_text())
    repo = config['repository']
    metadata = json.loads(run(['gh', 'api', f'repos/{repo}']))
    if not metadata.get('permissions', {}).get('admin'):
        raise ValueError('Repository administrator permission is required to configure signing secrets')
    keys = ROOT / 'build/cache/update-signing'
    if (keys / 'sivio.key.pub').read_text().strip() != config['publicKey']:
        raise ValueError('Local update identity does not match the committed public key')
    codesign = ROOT / 'build/cache/codesign'
    identity = json.loads((codesign / 'identity.json').read_text())
    keychain = codesign / 'signing.keychain-db'
    run(['security', 'unlock-keychain', '-p', (codesign / 'password').read_text(), keychain])
    if args.keychain_snapshot:
        # A locked snapshot preserves the authorized identity and its existing ACL.
        # This path is fixed to the project-owned keychain, not the user's keychains.
        run(['security', 'lock-keychain', keychain])
        try:
            snapshot = base64.b64encode(keychain.read_bytes())
        finally:
            run(['security', 'unlock-keychain', '-p', (codesign / 'password').read_text(), keychain])
        if len(snapshot) > 48 * 1024:
            raise ValueError('Dedicated keychain exceeds the GitHub secret size limit')
        values = {
            'SIVIO_SIGNING_KEYCHAIN': snapshot,
            'SIVIO_SIGNING_KEYCHAIN_PASSWORD': (codesign / 'password').read_bytes(),
            'TAURI_SIGNING_PRIVATE_KEY': (keys / 'sivio.key').read_bytes(),
            'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': (keys / 'password').read_bytes(),
        }
        for name, value in values.items():
            run(['gh', 'secret', 'set', name, '--repo', repo], value)
        run(['gh', 'variable', 'set', 'SIVIO_CODESIGN_IDENTITY', '--repo', repo, '--body', identity['certificateSha1']])
        print(f'Configured dedicated signing keychain and updater secrets for {repo}; no release or tag was created')
        return
    with tempfile.TemporaryDirectory(prefix='sivio-ci-identity-') as directory:
        p12 = Path(directory) / 'identity.p12'
        password = secrets.token_urlsafe(32)
        run(['security', 'export', '-k', keychain, '-t', 'identities', '-f', 'pkcs12', '-P', password, '-o', p12])
        p12.chmod(0o600)
        values = {
            'SIVIO_CERTIFICATE_P12': base64.b64encode(p12.read_bytes()),
            'SIVIO_CERTIFICATE_PASSWORD': password.encode(),
            'TAURI_SIGNING_PRIVATE_KEY': (keys / 'sivio.key').read_bytes(),
            'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': (keys / 'password').read_bytes(),
        }
        for name, value in values.items():
            run(['gh', 'secret', 'set', name, '--repo', repo], value)
        run(['gh', 'variable', 'set', 'SIVIO_CODESIGN_IDENTITY', '--repo', repo, '--body', identity['certificateSha1']])
    print(f'Configured signing secrets for {repo}; no release or tag was created')


if __name__ == '__main__':
    main()
