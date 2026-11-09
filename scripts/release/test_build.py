import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
import subprocess
from unittest.mock import patch
from version import ROOT
from sign import identity

spec = importlib.util.spec_from_file_location('build_app', ROOT / 'scripts/build-app.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ReleaseBuild(unittest.TestCase):
    def test_release_path_remapping_preserves_flags_and_paths_with_spaces(self):
        original = {'RUSTFLAGS': '--cfg release_check -C "link-arg=two words"'}
        with patch.object(build, 'ROOT', Path('/workspace/project with spaces')):
            env = build.release_compile_environment(original)
        flags = env['CARGO_ENCODED_RUSTFLAGS'].split('\x1f')
        self.assertEqual(flags[:4], ['--cfg', 'release_check', '-C', 'link-arg=two words'])
        self.assertEqual(flags[-1], '--remap-path-prefix=/workspace/project with spaces=/build/sivio')
        self.assertNotIn('RUSTFLAGS', env)
        self.assertIn('RUSTFLAGS', original)

    def test_release_path_remapping_honors_encoded_flag_precedence(self):
        env = build.release_compile_environment({'RUSTFLAGS': '--cfg ignored', 'CARGO_ENCODED_RUSTFLAGS': '--cfg\x1falready_encoded'})
        self.assertEqual(env['CARGO_ENCODED_RUSTFLAGS'].split('\x1f')[:2], ['--cfg', 'already_encoded'])
        self.assertNotIn('ignored', env['CARGO_ENCODED_RUSTFLAGS'])

    def test_release_never_creates_an_identity_implicitly(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            with identity():
                self.fail('Missing identity was accepted')

    def test_source_contains_build_inputs_but_not_private_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['app/src/main.ts', 'app/node_modules/private', 'app/src-tauri/resources/private', 'native/target/private',
                         'scripts/build-app.py', 'openspec/project.md', 'docs/implementation/notices.md', 'vendor/upstream/LICENSE', 'vendor/dependency-notices/pkg/LICENSE', 'vendor/cores/pinned.gz',
                         '.github/workflows/release.yml', 'README.md', 'LICENSE', '.cargo/config.toml', '.gitignore', 'build/reports/upstream-manifest.json']:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('fixture')
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', 'add', '.'], cwd=root, check=True)
            for name in ['app/.env', 'docs/untracked-secret', 'app/src/local-untracked.ts']:
                (root / name).write_text('must never ship')
            with patch.object(build, 'ROOT', root):
                archive, _ = build.package_source(root / 'out', 'Sivio', '0.2.0')
            with tarfile.open(archive) as tar:
                names = tar.getnames()
            self.assertIn('.github/workflows/release.yml', names)
            self.assertIn('build/reports/upstream-manifest.json', names)
            self.assertIn('vendor/dependency-notices/pkg/LICENSE', names)
            self.assertIn('vendor/cores/pinned.gz', names)
            self.assertFalse(any('private' in name for name in names))
            self.assertFalse(any('untracked' in name or '.env' in name for name in names))
            with tarfile.open(archive) as tar:
                self.assertTrue(all(m.uname == '' and m.gname == '' and m.uid == 0 for m in tar))
