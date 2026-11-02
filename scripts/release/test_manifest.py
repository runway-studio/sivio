import tempfile
import unittest
import io
import plistlib
import tarfile
from pathlib import Path
from manifest import build_manifest, verify_payload


def write_payload(path, version='0.2.0', source_name='source.tar.gz', source_sha='abc', extra=None):
    files = {
        'Sivio.app/Contents/Info.plist': plistlib.dumps(dict(CFBundleIdentifier='local.siassist.desktop', CFBundleShortVersionString=version, CFBundleExecutable='sivio-desktop')),
        'Sivio.app/Contents/MacOS/sivio-desktop': bytes.fromhex('cffaedfe0c000001') + bytes(24),
        'Sivio.app/Contents/Resources/legal/SOURCE.txt': f'File: {source_name}\nSHA256: {source_sha}\n'.encode(),
    }
    with tarfile.open(path, 'w:gz') as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            entry.mode = 0o755
            archive.addfile(entry, io.BytesIO(data))
        if extra:
            archive.addfile(extra)


class Manifest(unittest.TestCase):
    def test_payload_requires_matching_product_version_and_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.tar.gz'
            write_payload(path)
            verify_payload(path, '0.2.0', 'source.tar.gz', 'abc')
            for version, name, digest in [('0.3.0', 'source.tar.gz', 'abc'), ('0.2.0', 'other.tar.gz', 'abc'), ('0.2.0', 'source.tar.gz', 'wrong')]:
                with self.assertRaises(ValueError):
                    verify_payload(path, version, name, digest)

    def test_payload_rejects_traversal_links_and_duplicate_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.tar.gz'
            link = tarfile.TarInfo('Sivio.app/link')
            link.type = tarfile.SYMTYPE
            link.linkname = '/tmp/escape'
            for extra in [tarfile.TarInfo('Sivio.app/../escape'), tarfile.TarInfo('/Sivio.app/escape'), tarfile.TarInfo('Sivio.app/Contents/Info.plist'), link]:
                write_payload(path, extra=extra)
                with self.assertRaises(ValueError):
                    verify_payload(path, '0.2.0')

    def test_only_supported_platform_and_signature_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            sig = Path(directory) / 'app.sig'
            sig.write_text('signature-contents\n')
            report = dict(version='0.2.0', architecture='aarch64', signature=str(sig), updaterArtifact='Sivio-0.2.0-aarch64.app.tar.gz')
            result = build_manifest('0.2.0', 'runway-studio/sivio', [report], '说明', '2026-11-02T00:00:00Z')
            self.assertEqual(set(result['platforms']), {'darwin-aarch64'})
            self.assertEqual(result['platforms']['darwin-aarch64']['signature'], 'signature-contents')
            for reports in [[], [report, report], [{**report, 'architecture': 'x86_64'}], [{**report, 'version': '0.3.0'}]]:
                with self.assertRaises(ValueError):
                    build_manifest('0.2.0', 'runway-studio/sivio', reports, '', '2026-11-02T00:00:00Z')
            sig.write_text('')
            with self.assertRaises(ValueError):
                build_manifest('0.2.0', 'runway-studio/sivio', [report], '', '2026-11-02T00:00:00Z')
