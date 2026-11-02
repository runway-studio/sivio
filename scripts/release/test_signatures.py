"""Public minisign reference vectors: exercise the exact verifier used by the App."""
import base64
import os
import tempfile
import unittest
from pathlib import Path
from manifest import ROOT, verify

KEY = 'untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3'
SIG = ('untrusted comment: signature from minisign secret key\n'
       'RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\n'
       'trusted comment: timestamp:1556193335\tfile:test\n'
       'y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==')


class Signatures(unittest.TestCase):
    @unittest.skipUnless(Path(os.environ.get('SIVIO_UPDATE_VERIFIER', ROOT / 'build/cache/target/debug/sivio-update-verifier')).is_file(), 'build verifier before integration checks')
    def test_valid_and_tampered_bytes_use_production_verifier(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            artifact, signature = Path(directory) / 'test', Path(directory) / 'test.sig'
            artifact.write_bytes(b'test')
            signature.write_text(base64.b64encode(SIG.encode()).decode())
            key = base64.b64encode(KEY.encode()).decode()
            verify(artifact, signature, key)
            artifact.write_bytes(b'tampered')
            with self.assertRaises(subprocess.CalledProcessError):
                verify(artifact, signature, key)
