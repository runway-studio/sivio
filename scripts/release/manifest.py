"""Validate final release bytes before writing the Tauri feed."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import plistlib
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from version import ROOT, from_tag


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(artifact, signature, public_key):
    binary = Path(os.environ.get('SIVIO_UPDATE_VERIFIER', ROOT / 'build/cache/target/debug/sivio-update-verifier'))
    if not binary.is_file():
        raise ValueError('Build scripts/release/verifier before verifying release assets')
    with tempfile.NamedTemporaryFile(mode='w') as key:
        key.write(public_key)
        key.flush()
        subprocess.run([str(binary), str(artifact), str(signature), key.name], check=True)


def build_manifest(version, repo, reports, notes, pub_date):
    from_tag('v' + version)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid release repository')
    if datetime.fromisoformat(pub_date.replace('Z', '+00:00')).tzinfo is None:
        raise ValueError('Publication date requires timezone')
    platforms = {}
    for report in reports:
        if report['architecture'] != 'aarch64' or report['version'] != version:
            raise ValueError('Unverified platform or mismatched version')
        if 'darwin-aarch64' in platforms:
            raise ValueError('Duplicate platform')
        signature = Path(report['signature']).read_text().strip()
        if not signature:
            raise ValueError('Missing signature')
        platforms['darwin-aarch64'] = {
            'url': f'https://github.com/{repo}/releases/download/v{version}/{quote(Path(report["updaterArtifact"]).name)}',
            'signature': signature,
        }
    if not platforms:
        raise ValueError('No verified platforms')
    return {'version': version, 'notes': notes, 'pub_date': pub_date, 'platforms': platforms}


def verify_payload(path, version, source_name=None, source_sha=None):
    with tarfile.open(path, 'r:gz') as archive:
        entries = archive.getmembers()
        seen = set()
        total = 0
        for member in entries:
            parts = Path(member.name).parts
            if not parts or parts[0] != 'Sivio.app' or any(p in ('..', '/') for p in parts) or member.name in seen:
                raise ValueError('Unsafe or duplicate archive entry')
            if not member.isfile() and not member.isdir():
                raise ValueError('Unsupported archive entry')
            seen.add(member.name)
            total += member.size
            if member.size > 512 * 1024 * 1024 or total > 1024 * 1024 * 1024 or len(seen) > 30000:
                raise ValueError('Oversized application archive')
        info_file = archive.extractfile('Sivio.app/Contents/Info.plist')
        info = plistlib.loads(info_file.read(1024 * 1024))
        if info.get('CFBundleIdentifier') != 'local.siassist.desktop' or info.get('CFBundleShortVersionString') != version or info.get('CFBundleExecutable') != 'sivio-desktop':
            raise ValueError('Updater archive product/version mismatch')
        if source_name is not None:
            source = archive.extractfile('Sivio.app/Contents/Resources/legal/SOURCE.txt').read(65536).decode()
            if f'File: {source_name}\n' not in source or f'SHA256: {source_sha}\n' not in source:
                raise ValueError('Bundled source reference does not match the release source archive')
        binary = archive.getmember('Sivio.app/Contents/MacOS/sivio-desktop')
        header = archive.extractfile(binary).read(32)
        if len(header) != 32 or header[:8] != bytes.fromhex('cffaedfe0c000001') or not binary.mode & 0o100:
            raise ValueError('Updater archive is not executable Apple Silicon code')


def assemble(report_path, tag, notes, output):
    version = from_tag(tag)
    report = json.loads(Path(report_path).read_text())
    config = json.loads((ROOT / 'app/src-tauri/release-config.json').read_text())
    if not config['publicKey'] or report['publicKey'] != config['publicKey']:
        raise ValueError('Release public key does not match the application')
    if report['signing'] != 'stable-internal' or report['version'] != version:
        raise ValueError('Invalid release identity/version')
    if report.get('sourceDirty', True):
        raise ValueError('Uncommitted source is not a publishable release')
    if not re.fullmatch('[0-9a-f]{40}', report['sourceSha']):
        raise ValueError('Missing immutable source SHA')
    assets = {}
    for field, digest in [('archive', 'sha256'), ('updaterArtifact', 'updaterSha256'),
                          ('signature', 'signatureSha256'), ('sourceArchive', 'sourceSha256')]:
        path = ROOT / report[field]
        if not path.is_file() or path.name in assets or sha(path) != report[digest]:
            raise ValueError(f'Missing, duplicate or altered asset: {field}')
        assets[path.name] = path
    resolved = {**report, 'signature': str(ROOT / report['signature'])}
    verify(ROOT / report['updaterArtifact'], ROOT / report['signature'], config['publicKey'])
    verify_payload(ROOT / report['updaterArtifact'], version, Path(report['sourceArchive']).name, report['sourceSha256'])
    manifest = build_manifest(version, config['repository'], [resolved], notes, report['pubDate'])
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    import shutil
    for name, path in assets.items():
        destination = output / name
        if path.resolve() != destination.resolve():
            shutil.copy2(path, destination)
    (output / 'latest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    (output / 'release-notes.md').write_text(notes + '\n')
    evidence = {k: report[k] for k in ('sourceSha', 'version', 'architecture', 'signing', 'publicKey')}
    evidence['tag'] = tag
    (output / 'release-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    names = sorted([*assets, 'latest.json', 'release-notes.md', 'release-evidence.json'])
    (output / 'SHA256SUMS').write_text(''.join(f'{sha(output / name)}  {name}\n' for name in names))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--notes', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    assemble(args.report, args.tag, Path(args.notes).read_text(), args.output)
