"""Fail-closed release-content checks. Findings never include matched secret values."""
import argparse
import gzip
import hashlib
import io
import json
import lzma
import re
import subprocess
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST = Path(__file__).with_name('privacy-allowlist.json')
MAX_BYTES = 1024 * 1024 * 1024
RULES = {
    'internal-company': re.compile(rb'(?:my' + rb'hexin|hexin\.com|hxmatrix|10jqka)', re.I),
    'personal-home': re.compile(rb'/Us' + rb'ers/(?!me(?:/|\b)|test(?:/|\b)|runner(?:/|\b)|someone(?:/|\b)|username(?:/|\b)|user(?:/|\b)|alice(?:/|\b)|bob(?:/|\b)|octocat(?:/|\b)|example(?:/|\b))[^/\s"\'<>\\]{2,}/'),
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'),
    'access-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b'),
    'url-password': re.compile(rb'https?://[^/\s:@]+:[^/\s@]+@'),
}


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root)


def load_allowlist(path=ALLOWLIST):
    entries = json.loads(Path(path).read_text())
    if any(not x.get('reason') or not re.fullmatch('[0-9a-f]{64}', x['sha256']) for x in entries):
        raise ValueError('Invalid privacy exception')
    return {(x['path'], x['sha256'], rule) for x in entries for rule in x['rules']}


class Scanner:
    def __init__(self, exceptions=None):
        self.exceptions = load_allowlist() if exceptions is None else exceptions
        self.findings = set()
        self.total = 0

    def add(self, label, rule):
        self.findings.add((label, rule))

    def content(self, name, data, label=None, depth=0):
        label = label or name
        self.total += len(data)
        if self.total > MAX_BYTES or depth > 4:
            raise ValueError('Privacy scan size/depth limit exceeded')
        digest = hashlib.sha256(data).hexdigest()
        def permitted(rule):
            return (name, digest, rule) in self.exceptions
        parts = PurePosixPath(name).parts
        base = parts[-1] if parts else ''
        forbidden = (base.startswith('.env') and base not in ('.env.example', '.env.sample', '.env.template')) or base in ('.npmrc', 'credentials', 'auth.json') or base.endswith(('.p12', '.pfx', '.keychain-db', '.sqlite', '.sqlite3', '.db', '.log', '.key'))
        if forbidden and not permitted('credential-file'):
            self.add(label, 'credential-file')
        for rule, pattern in RULES.items():
            if pattern.search(data) and not permitted(rule):
                self.add(label, rule)
        # Inspect nested content as well as the outer bytes; never execute/extract it.
        if base.endswith(('.tar.gz', '.tgz', '.tar')):
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                seen = set()
                for member in archive:
                    child = PurePosixPath(member.name)
                    if child.is_absolute() or '..' in child.parts or member.name in seen or not (member.isfile() or member.isdir()):
                        raise ValueError('Unsafe privacy-scan archive member')
                    seen.add(member.name)
                    if member.isfile():
                        if member.size > MAX_BYTES - self.total:
                            raise ValueError('Privacy scan archive too large')
                        self.content(member.name, archive.extractfile(member).read(), label + '!' + member.name, depth + 1)
        elif base.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                seen = set()
                for member in archive.infolist():
                    child = PurePosixPath(member.filename)
                    if child.is_absolute() or '..' in child.parts or member.filename in seen or (member.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('Unsafe privacy-scan ZIP member')
                    seen.add(member.filename)
                    if not member.is_dir():
                        if member.file_size > MAX_BYTES - self.total:
                            raise ValueError('Privacy scan ZIP too large')
                        self.content(member.filename, archive.read(member), label + '!' + member.filename, depth + 1)
        elif base.endswith(('.gz', '.xz')):
            compressed = gzip.GzipFile(fileobj=io.BytesIO(data)) if base.endswith('.gz') else lzma.LZMAFile(io.BytesIO(data))
            with compressed:
                expanded = compressed.read(MAX_BYTES - self.total + 1)
            self.content(name.rsplit('.', 1)[0], expanded, label + '!expanded', depth + 1)

    def source(self, root=ROOT):
        root = Path(root)
        for name in git(root, 'ls-files', '-z').decode().split('\0'):
            if not name:
                continue
            path = root / name
            if path.is_symlink():
                self.add(name, 'source-symlink')
            elif path.is_file():
                self.content(name, path.read_bytes())
        return self

    def history(self, root=ROOT):
        # Use every reachable commit, including tag-only commits. Stream unique blobs.
        metadata = git(root, 'log', '--branches', '--tags', '--remotes', '--format=%H%x09%an <%ae>%x09%cn <%ce>%x09%B%x00')
        for record in metadata.split(b'\0'):
            if not record.strip():
                continue
            record = record.strip()
            label = 'commit:' + record[:40].decode('ascii', errors='replace')
            for rule, pattern in RULES.items():
                if pattern.search(record):
                    self.add(label, rule)
        for row in git(root, 'for-each-ref', '--format=%(objecttype) %(objectname)', 'refs/tags').decode().splitlines():
            kind, oid = row.split()
            if kind == 'tag':
                data = git(root, 'cat-file', 'tag', oid)
                for rule, pattern in RULES.items():
                    if pattern.search(data): self.add('tag:' + oid, rule)
        objects = git(root, 'rev-list', '--objects', '--branches', '--tags', '--remotes').decode().splitlines()
        process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            for row in objects:
                if ' ' not in row:
                    continue
                oid, name = row.split(' ', 1)
                process.stdin.write((oid + '\n').encode()); process.stdin.flush()
                header = process.stdout.readline().split()
                data = process.stdout.read(int(header[2])); process.stdout.read(1)
                if header[1] == b'blob':
                    self.content(name, data, 'blob:' + oid + ':' + name)
        finally:
            process.stdin.close(); process.stdout.close(); process.wait()
        return self

    def artifacts(self, folder):
        for path in sorted(Path(folder).iterdir()):
            if path.is_symlink() or not path.is_file():
                raise ValueError('Unexpected release asset type')
            self.content(path.name, path.read_bytes())
        return self

    def require_clean(self):
        if self.findings:
            # Paths and rule IDs only; never print the source line or matched value.
            raise ValueError('Sensitive publication content:\n' + '\n'.join(f'{rule}: {path}' for path, rule in sorted(self.findings)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', action='store_true')
    parser.add_argument('--history', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--assets', type=Path)
    args = parser.parse_args()
    if not (args.source or args.history or args.assets):
        parser.error('Select --source, --history and/or --assets')
    scanner = Scanner()
    if args.source: scanner.source(args.root)
    if args.history: scanner.history(args.root)
    if args.assets: scanner.artifacts(args.assets)
    scanner.require_clean()
    print('Privacy checks passed (source/history/archives selected above; static patterns and exact fixture exceptions).')


if __name__ == '__main__':
    main()
