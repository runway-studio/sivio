import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from dmg import build_dmg, tree_digest


class DiskImage(unittest.TestCase):
    def test_application_links_are_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'outside').symlink_to('/Applications')
            with self.assertRaises(ValueError):
                tree_digest(root)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires macOS disk images and codesign')
    def test_signed_app_survives_dmg_creation_and_readonly_mount(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / 'Sivio.app'
            binary = app / 'Contents/MacOS/sivio-desktop'
            binary.parent.mkdir(parents=True)
            (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
                'CFBundleIdentifier': 'local.siassist.desktop',
                'CFBundleExecutable': 'sivio-desktop',
                'CFBundleShortVersionString': '0.1.2',
                'CFBundlePackageType': 'APPL',
            }))
            source = root / 'main.c'
            source.write_text('int main(void) { return 0; }\n')
            subprocess.run(['clang', str(source), '-o', str(binary)], check=True)
            subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
            before = tree_digest(app)
            report = build_dmg(app, root / 'Sivio.dmg', '0.1.2')
            self.assertTrue(report['verified'])
            self.assertTrue(report['signatureVerified'])
            self.assertEqual(tree_digest(app), before)
            self.assertTrue((root / 'Sivio.dmg').is_file())
