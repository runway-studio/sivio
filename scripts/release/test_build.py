import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from version import ROOT
from sign import identity

spec = importlib.util.spec_from_file_location('build_app', ROOT / 'scripts/build-app.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ReleaseBuild(unittest.TestCase):
    def test_release_never_creates_an_identity_implicitly(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            with identity():
                self.fail('Missing identity was accepted')

    def test_source_contains_build_inputs_but_not_private_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['app/src/main.ts', 'app/node_modules/private', 'app/src-tauri/resources/private', 'native/target/private',
                         'scripts/build-app.py', 'openspec/project.md', 'docs/implementation/notices.md', 'vendor/upstream/LICENSE', 'vendor/dependency-notices/pkg/LICENSE',
                         '.github/workflows/release.yml', 'README.md', 'LICENSE', '.cargo/config.toml', '.gitignore', 'build/reports/upstream-manifest.json']:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture')
            with patch.object(build, 'ROOT', root):
                archive, _ = build.package_source(root / 'out', 'Sivio', '0.2.0')
            with tarfile.open(archive) as tar:
                names = tar.getnames()
            self.assertIn('.github/workflows/release.yml', names)
            self.assertIn('build/reports/upstream-manifest.json', names)
            self.assertIn('vendor/dependency-notices/pkg/LICENSE', names)
            self.assertFalse(any('private' in name for name in names))
