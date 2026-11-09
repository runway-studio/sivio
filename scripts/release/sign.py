"""Release signing uses an existing identity, never an implicit replacement."""
import base64
import contextlib
import os
import re
import secrets
import shlex
import subprocess
import tempfile
from pathlib import Path


def run(args, **kwargs):
    result = subprocess.run([str(x) for x in args], capture_output=True, **kwargs)
    if result.returncode:
        if Path(str(args[0])).name == 'codesign':
            # codesign receives only public fingerprints and file paths, never passwords/keys.
            message = result.stderr.decode(errors='replace')[:2000]
            for name in ('SIVIO_SIGNING_KEYCHAIN_PASSWORD', 'SIVIO_CERTIFICATE_PASSWORD', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'):
                secret = os.environ.get(name)
                if secret:
                    message = message.replace(secret, '[REDACTED]')
            raise RuntimeError('codesign failed: ' + message)
        # Security CLI errors can echo password/key arguments. Do not print them.
        raise RuntimeError(f'{Path(str(args[0])).name} failed (exit {result.returncode}); signing output withheld')
    return result.stdout


@contextlib.contextmanager
def runner_discovery(keychain):
    """Use the temporary identity for discovery only on an ephemeral GitHub runner."""
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        yield
        return
    paths = shlex.split(run(['security', 'list-keychains', '-d', 'user']).decode())
    if str(keychain) not in paths:
        run(['security', 'list-keychains', '-d', 'user', '-s', *paths, keychain])
    try:
        yield
    finally:
        current = shlex.split(run(['security', 'list-keychains', '-d', 'user']).decode())
        run(['security', 'list-keychains', '-d', 'user', '-s', *[p for p in current if p != str(keychain)]])


@contextlib.contextmanager
def identity():
    fingerprint = os.environ.get('SIVIO_CODESIGN_IDENTITY', '')
    if not re.fullmatch(r'[A-Fa-f0-9]{40}', fingerprint):
        raise ValueError('SIVIO_CODESIGN_IDENTITY must be the stable certificate SHA1 fingerprint')
    snapshot = os.environ.get('SIVIO_SIGNING_KEYCHAIN')
    if snapshot:
        # Only the dedicated Sivio keychain is supplied; never a user's login keychain.
        with tempfile.TemporaryDirectory(prefix='sivio-release-signing-') as directory:
            keychain = Path(directory) / 'release.keychain-db'
            keychain.write_bytes(base64.b64decode(snapshot, validate=True))
            keychain.chmod(0o600)
            try:
                password = os.environ['SIVIO_SIGNING_KEYCHAIN_PASSWORD']
                run(['security', 'unlock-keychain', '-p', password, keychain])
                run(['security', 'set-keychain-settings', '-lut', '21600', keychain])
                run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
                with runner_discovery(keychain):
                    yield fingerprint, str(keychain)
            finally:
                subprocess.run(['security', 'lock-keychain', str(keychain)], capture_output=True)
        return
    encoded = os.environ.get('SIVIO_CERTIFICATE_P12')
    if not encoded:
        path = os.environ.get('SIVIO_CODESIGN_KEYCHAIN')
        if not path or not Path(path).is_file():
            raise ValueError('Provide a stable P12 identity or existing signing keychain')
        yield fingerprint, path
        return
    with tempfile.TemporaryDirectory(prefix='sivio-release-signing-') as directory:
        root = Path(directory)
        p12, keychain = root / 'identity.p12', root / 'release.keychain-db'
        p12.write_bytes(base64.b64decode(encoded, validate=True))
        p12.chmod(0o600)
        password = secrets.token_urlsafe(32)
        try:
            run(['security', 'create-keychain', '-p', password, keychain])
            run(['security', 'set-keychain-settings', '-lut', '21600', keychain])
            run(['security', 'unlock-keychain', '-p', password, keychain])
            run(['security', 'import', p12, '-k', keychain, '-P', os.environ['SIVIO_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign'])
            run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
            with runner_discovery(keychain):
                yield fingerprint, str(keychain)
        finally:
            subprocess.run(['security', 'delete-keychain', str(keychain)], capture_output=True)


def probe_identity(fingerprint, keychain):
    """Fail before an expensive build if the runner cannot use the stable identity."""
    with tempfile.TemporaryDirectory(prefix='sivio-signing-probe-') as directory:
        source, binary = Path(directory) / 'probe.c', Path(directory) / 'probe'
        source.write_text('int main(void) { return 0; }\n')
        run(['/usr/bin/clang', source, '-o', binary])
        run(['/usr/bin/codesign', '--force', '--sign', fingerprint, '--keychain', keychain, '--identifier', 'local.siassist.signing-probe', binary])
        run(['/usr/bin/codesign', '--verify', '--strict', '--test-requirement', '=certificate leaf = H"' + fingerprint + '"', binary])


def sign_bundle(app, fingerprint, keychain, identifier):
    binaries = app / 'Contents/Resources/network'
    for name in ['sivio-helper', 'sivio-helper-install', 'sivio-helper-uninstall', 'si-helper-control', 'si-network-supervisor']:
        # Tauri may re-sign resources with their filename as identifier. Restore
        # the identity required by the helper after that packaging step.
        nested_identifier = {'si-helper-control': 'local.siassist.validation',
                             'si-network-supervisor': 'local.siassist.supervisor'}.get(name, 'local.siassist.' + name)
        run(['codesign', '--force', '--sign', fingerprint, '--keychain', keychain, '--options', 'runtime',
             '--identifier', nested_identifier, binaries / name])
        run(['codesign', '--verify', '--strict', '--test-requirement',
             f'=identifier "{nested_identifier}" and certificate leaf = H"{fingerprint}"', binaries / name])
    requirement = f'designated => identifier "{identifier}" and certificate leaf = H"{fingerprint}"'
    run(['codesign', '--force', '--sign', fingerprint, '--keychain', keychain, '--options', 'runtime', '--identifier', identifier,
         '--requirements', '=' + requirement, '--preserve-metadata=entitlements', app])
    run(['codesign', '--verify', '--deep', '--strict', app])
    run(['codesign', '--verify', '--test-requirement', '=' + requirement.removeprefix('designated => '), app])


def sign_update(path, version, root):
    if not (os.environ.get('TAURI_SIGNING_PRIVATE_KEY') or os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PATH')):
        raise ValueError('Tauri update signing key is required')
    run(['pnpm', 'exec', 'tauri', 'signer', 'sign', '--app-version', version, path], cwd=root / 'app')
    return Path(str(path) + '.sig')
