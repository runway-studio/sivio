#!/usr/bin/env python3
"""Regression: publishing another build must preserve a live macOS code identity."""
import importlib.util
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("build_app", ROOT / "scripts/build-app.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BundlePublicationTests(unittest.TestCase):
    def test_previous_bundles_and_legacy_path_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source/Sivio.app"
            source.mkdir(parents=True)
            (source / "resource").write_text("first")
            output = root / "dist"
            legacy = output / "Sivio.app"
            legacy.mkdir(parents=True)
            (legacy / "resource").write_text("legacy")
            first = build.copy_versioned_bundle(source, output)
            first_inode = (first / "resource").stat().st_ino
            (source / "resource").write_text("second")
            second = build.copy_versioned_bundle(source, output)
            self.assertNotEqual(first, second)
            self.assertEqual((first / "resource").read_text(), "first")
            self.assertEqual((first / "resource").stat().st_ino, first_inode)
            self.assertEqual((second / "resource").read_text(), "second")
            self.assertEqual((legacy / "resource").read_text(), "legacy")

    @unittest.skipUnless(sys.platform == "darwin", "requires macOS dynamic code validation")
    def test_live_code_stays_valid_across_second_publication(self):
        with tempfile.TemporaryDirectory(prefix="sivio-publication-", dir="/private/tmp") as directory:
            root = Path(directory)
            source = root / "source/Sivio.app"
            binary = source / "Contents/MacOS/probe"
            binary.parent.mkdir(parents=True)
            (source / "Contents/Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "local.sivio.publication-probe",
                "CFBundleExecutable": "probe",
                "CFBundlePackageType": "APPL",
            }))
            code = root / "probe.c"
            code.write_text('#include <unistd.h>\n#include <stdio.h>\nint main(){puts("ready");fflush(stdout);while(1)pause();}\n')
            subprocess.run(["/usr/bin/clang", str(code), "-o", str(binary)], check=True)
            subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(source)], check=True, capture_output=True)
            first = build.copy_versioned_bundle(source, root / "dist")
            process = subprocess.Popen([str(first / "Contents/MacOS/probe")], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(process.stdout.readline().strip(), "ready")
                def check_live():
                    result = subprocess.run(["/usr/bin/codesign", "--verify", "--verbose=2", str(process.pid)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                check_live()
                # Change the source's code directory, then publish a second build.
                (source / "Contents/Info.plist").write_bytes(plistlib.dumps({
                    "CFBundleIdentifier": "local.sivio.publication-probe",
                    "CFBundleExecutable": "probe",
                    "CFBundlePackageType": "APPL",
                    "CFBundleVersion": "2",
                }))
                subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", str(source)], check=True, capture_output=True)
                second = build.copy_versioned_bundle(source, root / "dist")
                self.assertNotEqual(first, second)
                check_live()
                subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(second)], check=True, capture_output=True)
            finally:
                process.terminate()
                process.wait(timeout=5)
                process.stdout.close()


if __name__ == "__main__":
    unittest.main()
