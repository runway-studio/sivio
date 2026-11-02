"""Publish an already verified release set. Published assets are never overwritten."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from manifest import ROOT, sha, verify, verify_payload
from version import from_tag, parse


def verify_local(folder, tag, source_sha, config):
    folder = Path(folder)
    evidence = json.loads((folder / 'release-evidence.json').read_text())
    version = from_tag(tag)
    if evidence['sourceSha'] != source_sha or evidence['version'] != version or evidence['tag'] != tag:
        raise ValueError('Release source/tag/version mismatch')
    if evidence['architecture'] != 'aarch64' or evidence['signing'] != 'stable-internal' or evidence['publicKey'] != config['publicKey']:
        raise ValueError('Unverified platform or signing identity')
    expected = {}
    for line in (folder / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if not re.fullmatch('[0-9a-f]{64}', digest) or Path(name).name != name or name in expected:
            raise ValueError('Invalid checksum entry')
        if (folder / name).is_symlink() or sha(folder / name) != digest:
            raise ValueError('Asset hash mismatch: ' + name)
        expected[name] = digest
    if set(p.name for p in folder.iterdir()) != set(expected) | {'SHA256SUMS'}:
        raise ValueError('Unexpected or missing release assets')
    archive = f'Sivio-{version}-aarch64.app.tar.gz'
    required = {archive, archive + '.sig', f'Sivio-{version}-aarch64.zip', 'latest.json', 'release-notes.md', 'release-evidence.json'}
    sources = [name for name in expected if re.fullmatch(r'Sivio-' + re.escape(version) + r'-source-[0-9a-f]{12}\.tar\.gz', name)]
    if not required.issubset(expected) or len(sources) != 1:
        raise ValueError('Incomplete release set')
    manifest = json.loads((folder / 'latest.json').read_text())
    platform = manifest['platforms']
    url = f'https://github.com/{config["repository"]}/releases/download/{tag}/{archive}'
    if manifest['version'] != version or set(platform) != {'darwin-aarch64'}:
        raise ValueError('Invalid updater platforms/version')
    if platform['darwin-aarch64'] != {'url': url, 'signature': (folder / (archive + '.sig')).read_text().strip()}:
        raise ValueError('Manifest does not match the signed asset')
    verify(folder / archive, folder / (archive + '.sig'), config['publicKey'])
    verify_payload(folder / archive, version, sources[0], expected[sources[0]])
    expected['SHA256SUMS'] = sha(folder / 'SHA256SUMS')
    return manifest, expected


def publication_policy(tag, existing, latest):
    version = from_tag(tag)
    if existing and not existing['draft']:
        raise ValueError('Release is already published; use a new version')
    prerelease = '-rc.' in version
    if not prerelease and latest and parse(version) <= parse(from_tag(latest['tag_name'])):
        raise ValueError('A stable release must be newer than the current latest')
    return prerelease


class Github:
    def __init__(self, repo):
        self.base = f'https://api.github.com/repos/{repo}'
        self.token = os.environ['GH_TOKEN']

    def api(self, path, method='GET', data=None, optional=False):
        request = urllib.request.Request(self.base + path, method=method,
            data=None if data is None else json.dumps(data).encode(),
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'User-Agent': 'Sivio-release'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as error:
            if error.code == 404 and optional:
                return None
            raise RuntimeError(f'GitHub {method} {path} failed with HTTP {error.code}') from None


def anonymous_check(folder, config, tag, manifest, expected):
    base = f'https://github.com/{config["repository"]}/releases/download/{tag}/'
    # No Authorization header: this is the same public transport used by the app.
    for name, digest in expected.items():
        request = urllib.request.Request(base + name, headers={'User-Agent': 'Sivio-release-check'})
        with urllib.request.urlopen(request, timeout=300) as response:
            actual = hashlib.file_digest(response, 'sha256').hexdigest()
        if actual != digest:
            raise ValueError('Published asset hash mismatch: ' + name)
    if '-rc.' not in manifest['version']:
        with urllib.request.urlopen(config['endpoint'], timeout=60) as response:
            live = json.load(response)
        if live != manifest:
            raise ValueError('Official latest endpoint does not serve this manifest')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--assets', required=True)
    parser.add_argument('--publish', action='store_true', help='Otherwise create/update a draft only')
    args = parser.parse_args()
    from privacy import Scanner
    Scanner().source().history().require_clean()
    Scanner().artifacts(args.assets).require_clean()
    config = json.loads((ROOT / 'app/src-tauri/release-config.json').read_text())
    manifest, expected = verify_local(args.assets, args.tag, args.sha, config)
    github = Github(config['repository'])
    repository = github.api('')
    if repository['private']:
        raise ValueError('Official updater assets must be anonymously readable; repository is private')
    if github.api('/commits/' + args.tag)['sha'] != args.sha:
        raise ValueError('Remote tag no longer matches the built source')
    existing = github.api('/releases/tags/' + args.tag, optional=True)
    latest = github.api('/releases/latest', optional=True)
    prerelease = publication_policy(args.tag, existing, latest)
    if existing and existing['target_commitish'] != args.sha:
        raise ValueError('Draft belongs to a different source commit')
    notes = (Path(args.assets) / 'release-notes.md').read_text()
    release = existing or github.api('/releases', 'POST', dict(tag_name=args.tag, target_commitish=args.sha,
        name='Sivio ' + args.tag, body=notes, draft=True, prerelease=prerelease))
    release_path = '/releases/' + str(release['id'])
    if not github.api(release_path)['draft']:
        raise ValueError('Draft was published concurrently; refusing asset changes')
    for asset in release.get('assets', []):
        wanted = expected.get(asset['name'])
        if wanted and asset.get('digest') == 'sha256:' + wanted:
            continue
        github.api('/releases/assets/' + str(asset['id']), 'DELETE')
    present = {a['name'] for a in github.api(release_path)['assets']}
    missing = [str(Path(args.assets) / name) for name in expected if name not in present]
    if missing:
        subprocess.run(['gh', 'release', 'upload', args.tag, '--repo', config['repository'], *missing], check=True)
    uploaded = github.api(release_path)
    actual = {a['name']: a.get('digest', '').removeprefix('sha256:') for a in uploaded['assets']}
    if actual != expected:
        raise ValueError('Uploaded release assets do not match the verified set')
    if not args.publish:
        print('Verified draft: ' + uploaded['html_url'])
        return
    publication_policy(args.tag, uploaded, github.api('/releases/latest', optional=True))
    if github.api('/commits/' + args.tag)['sha'] != args.sha:
        raise ValueError('Tag changed before publication')
    github.api(release_path, 'PATCH', dict(body=notes, draft=False, prerelease=prerelease, make_latest='false' if prerelease else 'true'))
    try:
        anonymous_check(Path(args.assets), config, args.tag, manifest, expected)
    except Exception:
        # Do not delete immutable assets. Restore selection of the previously verified release.
        if latest and not prerelease:
            github.api('/releases/' + str(latest['id']), 'PATCH', {'make_latest': 'true'})
        raise RuntimeError('Publication readback failed; previous latest restored where available. Inspect the release before distribution.') from None
    print('Published and anonymously verified: ' + uploaded['html_url'])


if __name__ == '__main__':
    main()
