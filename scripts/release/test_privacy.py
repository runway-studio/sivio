import hashlib
import io
import subprocess
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from privacy import Scanner


class PrivacyTests(unittest.TestCase):
    def test_sensitive_values_redacted_and_public_keys_allowed(self):
        bad = {
            'internal-company': b'https://repositories.' + b'my' + b'hex' + b'in.com/repo',
            'personal-home': b'/Users/' + b'private-person/project/file',
            'private-key': b'-----BEGIN ' + b'OPENSSH PRIVATE KEY-----',
            'access-token': b'ghp_' + b'Z' * 36,
            'url-password': b'https://' + b'owner:secret@example.org',
        }
        for rule, secret in bad.items():
            scanner = Scanner(set())
            scanner.content('source.txt', secret)
            self.assertIn(('source.txt', rule), scanner.findings)
            with self.assertRaises(ValueError) as error: scanner.require_clean()
            self.assertNotIn(secret.decode(), str(error.exception))
        clean = Scanner(set())
        clean.content('release-config.json', b'{"publicKey":"public-verification-key"}')
        clean.content('fixture.txt', b'/Users/me/example /Users/runner/work')
        clean.require_clean()

    def test_exceptions_are_path_digest_and_rule_specific(self):
        data = b'-----BEGIN ' + b'EC PRIVATE KEY-----'
        exception = {('public-test.pem', hashlib.sha256(data).hexdigest(), 'private-key')}
        clean = Scanner(exception); clean.content('public-test.pem', data); clean.require_clean()
        for name, payload in [('other.pem', data), ('public-test.pem', data + b'changed')]:
            scanner = Scanner(exception); scanner.content(name, payload)
            with self.assertRaises(ValueError): scanner.require_clean()

    def test_nested_archive_and_credential_filename(self):
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, 'w') as archive:
            archive.writestr('app/.env', 'fixture')
        outer = io.BytesIO()
        with tarfile.open(fileobj=outer, mode='w:gz') as archive:
            entry = tarfile.TarInfo('nested.zip'); entry.size = len(inner.getvalue())
            archive.addfile(entry, io.BytesIO(inner.getvalue()))
        scanner = Scanner(set()); scanner.content('release.tar.gz', outer.getvalue())
        self.assertIn(('release.tar.gz!nested.zip!app/.env', 'credential-file'), scanner.findings)
        with self.assertRaises(ValueError): scanner.require_clean()

    def test_unsafe_archive_rejected(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive: archive.writestr('../escape', '')
        with self.assertRaises(ValueError): Scanner(set()).content('unsafe.zip', data.getvalue())

    def test_history_catches_deleted_values_and_author_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args): subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
            git('init', '-q'); git('config', 'user.name', 'Fixture')
            git('config', 'user.email', 'fixture@' + 'my' + 'hex' + 'in.com')
            (root / 'old.txt').write_text('ghp_' + 'Z' * 36)
            git('add', '.'); git('commit', '-qm', 'fixture')
            git('rm', 'old.txt'); git('commit', '-qm', 'remove')
            scanner = Scanner(set()).history(root)
            self.assertTrue(any(p.startswith('commit:') and r == 'internal-company' for p, r in scanner.findings))
            self.assertTrue(any(p.startswith('blob:') and r == 'access-token' for p, r in scanner.findings))
