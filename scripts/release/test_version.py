import json
import tempfile
import unittest
from pathlib import Path
from version import check, from_tag, parse, set_version


class Versions(unittest.TestCase):
    def test_tags_and_order(self):
        self.assertEqual(from_tag('v1.2.3-rc.2'), '1.2.3-rc.2')
        self.assertLess(parse('1.2.3-rc.10'), parse('1.2.3'))
        self.assertLess(parse('1.2.3-rc.2'), parse('1.2.3-rc.10'))
        for value in ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-beta.1', 'v1.2.3\n']:
            with self.assertRaises(ValueError):
                from_tag(value)

    def test_synchronize_only_product(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app/src-tauri').mkdir(parents=True)
            for name in ['app/package.json', 'app/src-tauri/tauri.conf.json']:
                (root / name).write_text(json.dumps({'version': '0.1.0'}))
            (root / 'app/src-tauri/Cargo.toml').write_text('[package]\nname = "sivio-desktop"\nversion = "0.1.0"\n')
            lock = root / 'app/src-tauri/Cargo.lock'
            lock.write_text('[[package]]\nname = "helper"\nversion = "7.0.0"\n\n[[package]]\nname = "sivio-desktop"\nversion = "0.1.0"\n')
            with self.assertRaises(ValueError):
                check('v0.2.0', root)
            set_version('0.2.0', root)
            self.assertEqual(check('v0.2.0', root), '0.2.0')
            self.assertIn('version = "7.0.0"', lock.read_text())
