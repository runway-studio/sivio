#!/usr/bin/env python3
"""Reproduce source digests, dependency locks and IPC inventory without running upstream code."""
import hashlib
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'build/reports'
SOURCES = [
 ('cc-switch', 'farion1231/cc-switch', '51ac86f1c59abfefabadebd05ec5a5415b8ad72c', '/tmp/si-cc-switch.tar.gz'),
 ('clash-verge-rev', 'clash-verge-rev/clash-verge-rev', '4337bd85758d54d7b9044b2da3c9ac1176eae1f3', '/tmp/si-clash-verge.tar.gz'),
 ('clash-verge-service-ipc', 'clash-verge-rev/clash-verge-service-ipc', 'b2a7427d6681c8d3780ab83a73f4dc21da2f22d6', '/tmp/si-service-ipc.tar.gz'),
]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest = {'schemaVersion': 1, 'status': 'partial-M0-not-passed', 'sources': [], 'kernels': []}
commands = []
for name, repo, commit, archive in SOURCES:
    source = ROOT / 'vendor/upstream' / name
    files = {str(f.relative_to(source)): sha(f) for f in sorted(source.rglob('*')) if f.is_file()}
    manifest['sources'].append({
        'name': name, 'repository': 'https://github.com/' + repo,
        'commit': commit, 'archiveUrl': f'https://codeload.github.com/{repo}/tar.gz/{commit}',
        'archiveSha256': sha(Path(archive)) if Path(archive).exists() else None,
        'treeSha256': hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
        'fileHashes': files,
        'licenses': [f for f in files if Path(f).name.upper().startswith('LICENSE')],
        'locks': [f for f in files if Path(f).name in ['Cargo.lock', 'pnpm-lock.yaml']],
    })
    lock = source / 'Cargo.lock'
    if not lock.exists():
        lock = source / 'src-tauri/Cargo.lock'
    if lock.exists():
        packages = tomllib.loads(lock.read_text()).get('package', [])
        manifest['sources'][-1]['gitDependencies'] = [
            {'name': x['name'], 'version': x['version'], 'source': x['source']}
            for x in packages if x.get('source', '').startswith('git+')]
    for f in sorted(source.rglob('*.rs')):
        text = f.read_text()
        for match in re.finditer(r'#\[(?:tauri::)?command(?:\([^\]]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)', text):
            commands.append({'source': name, 'file': str(f.relative_to(source)),
                             'line': text.count('\n', 0, match.start()) + 1,
                             'command': match.group(1), 'featureId': None,
                             'reviewStatus': 'requires-operation-level-feature-mapping'})
for channel in ['stable', 'alpha']:
    release = json.loads((OUT / f'mihomo-{channel}-release.json').read_text())
    for asset in release['assets']:
        if re.fullmatch(r'mihomo-darwin-(?:arm64|amd64-v1)-go122-.+\.gz', asset['name']):
            manifest['kernels'].append({
                'channel': channel, 'releaseId': release['id'], 'assetId': asset['id'],
                'versionFromFilename': asset['name'].split('go122-')[1].removesuffix('.gz'),
                'architecture': 'aarch64-apple-darwin' if 'arm64' in asset['name'] else 'x86_64-apple-darwin',
                'filename': asset['name'], 'url': asset['browser_download_url'],
                'sha256': asset.get('digest'), 'size': asset['size'],
                'verification': 'publisher API metadata only; binary not downloaded or verified',
                'mutableRelease': channel == 'alpha'})
manifest['openItems'] = ['helper identity patch and paired binary builds',
 'kernel binary hash verification and minimum OS inspection',
 'macOS-only command, UI setting and manual-operation mapping to F01-F36',
 'unified Cargo/pnpm lock and two-architecture build', 'TUN and lease recovery hardware evidence']
OUT.mkdir(exist_ok=True, parents=True)
(OUT / 'upstream-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
(OUT / 'upstream-command-inventory.json').write_text(json.dumps(commands, indent=2)+'\n')
print(json.dumps({'sources':len(SOURCES), 'commandsRequiringReview':len(commands), 'kernelAssets':len(manifest['kernels'])}))
