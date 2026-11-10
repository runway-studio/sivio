import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch
from publish import find_release, publication_policy, verify_local
from manifest import sha, build_manifest
from test_manifest import write_payload


class Publication(unittest.TestCase):
    def test_interrupted_draft_is_found_after_tag_endpoint_returns_404(self):
        draft = {'id': 123, 'tag_name': 'v0.2.0', 'draft': True}
        github = Mock()
        github.api.side_effect = [None, [{'tag_name': 'v0.1.0'}] * 100, [draft]]
        self.assertEqual(find_release(github, 'v0.2.0'), draft)
        github.api.assert_any_call('/releases?per_page=100&page=2')

    def test_published_release_is_preserved_and_duplicate_drafts_are_rejected(self):
        published = {'tag_name': 'v0.2.0', 'draft': False}
        github = Mock()
        github.api.return_value = published
        self.assertEqual(find_release(github, 'v0.2.0'), published)
        self.assertEqual(github.api.call_count, 1)
        github.api.side_effect = [None, [{'tag_name': 'v0.2.0', 'draft': True}] * 2]
        with self.assertRaises(ValueError):
            find_release(github, 'v0.2.0')

    def test_verified_set_rejects_missing_tampered_and_unrelated_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / 'Sivio-0.2.0-aarch64.app.tar.gz'
            source = root / 'Sivio-0.2.0-source-123456789abc.tar.gz'
            source.write_bytes(b'corresponding source fixture')
            write_payload(archive, source_name=source.name, source_sha=sha(source))
            signature = Path(str(archive) + '.sig')
            signature.write_text('signature-contents')
            (root / 'Sivio-0.2.0-aarch64.zip').write_bytes(b'install fixture')
            (root / 'Sivio-0.2.0-aarch64.dmg').write_bytes(b'dmg fixture')
            config = dict(publicKey='public', repository='runway-studio/sivio')
            evidence = dict(version='0.2.0', tag='v0.2.0', architecture='aarch64', signing='stable-internal', publicKey='public', sourceSha='a' * 40, dmgVerification={'verified': True})
            (root / 'release-evidence.json').write_text(json.dumps(evidence))
            manifest = build_manifest('0.2.0', config['repository'], [dict(version='0.2.0', architecture='aarch64', signature=signature, updaterArtifact=archive)], 'notes', '2026-11-02T00:00:00Z')
            (root / 'latest.json').write_text(json.dumps(manifest))
            (root / 'release-notes.md').write_text('notes')
            (root / 'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.name}\n' for p in sorted(root.iterdir())))
            # Signature cryptography is exercised with real public vectors in test_signatures.
            with patch('publish.verify'):
                verify_local(root, 'v0.2.0', 'a' * 40, config)
                dmg = root / 'Sivio-0.2.0-aarch64.dmg'
                dmg.unlink()
                with self.assertRaises((ValueError, FileNotFoundError)):
                    verify_local(root, 'v0.2.0', 'a' * 40, config)
                dmg.write_bytes(b'dmg fixture')
                with self.assertRaises(ValueError):
                    verify_local(root, 'v0.2.0', 'b' * 40, config)
                stray = root / 'unexpected.txt'
                stray.write_text('unrelated')
                with self.assertRaises(ValueError):
                    verify_local(root, 'v0.2.0', 'a' * 40, config)
                stray.unlink()
                archive.write_bytes(b'tampered')
                with self.assertRaises(ValueError):
                    verify_local(root, 'v0.2.0', 'a' * 40, config)
                archive.unlink()
                with self.assertRaises((ValueError, FileNotFoundError)):
                    verify_local(root, 'v0.2.0', 'a' * 40, config)

    def test_stable_order_and_draft_gate(self):
        self.assertFalse(publication_policy('v0.2.0', {'draft': True}, {'tag_name': 'v0.1.0'}))
        self.assertTrue(publication_policy('v0.3.0-rc.1', None, {'tag_name': 'v0.2.0'}))
        for tag, existing, latest in [
            ('v0.2.0', {'draft': False}, None),
            ('v0.2.0', None, {'tag_name': 'v0.2.0'}),
            ('v0.1.9', None, {'tag_name': 'v0.2.0'}),
        ]:
            with self.assertRaises(ValueError):
                publication_policy(tag, existing, latest)
