"""One product version; never modify dependency or helper protocol versions."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?\Z')


def parse(value):
    match = VERSION.fullmatch(value)
    if not match:
        raise ValueError('Expected X.Y.Z or X.Y.Z-rc.N without leading zeroes')
    major, minor, patch, rc = match.groups()
    return (int(major), int(minor), int(patch), rc is None, int(rc or 0))


def from_tag(tag):
    if not tag.startswith('v'):
        raise ValueError('Release tag must start with v')
    parse(tag[1:])
    return tag[1:]


def product_pattern(section):
    return re.compile(r'(' + re.escape(section) + r'\nname = "sivio-desktop"\nversion = ")([^"]+)(")')


def check(tag, root=ROOT):
    version = from_tag(tag)
    values = [json.loads((root / p).read_text())['version'] for p in
              ('app/package.json', 'app/src-tauri/tauri.conf.json')]
    for name, section in [('Cargo.toml', '[package]'), ('Cargo.lock', '[[package]]')]:
        match = product_pattern(section).search((root / 'app/src-tauri' / name).read_text())
        if not match:
            raise ValueError(f'Missing product version in {name}')
        values.append(match[2])
    if any(v != version for v in values):
        raise ValueError(f'Tag {tag} does not match product versions: {values}')
    return version


def set_version(version, root=ROOT):
    parse(version)
    updates = {}
    for name in ('app/package.json', 'app/src-tauri/tauri.conf.json'):
        path = root / name
        data = json.loads(path.read_text())
        data['version'] = version
        updates[path] = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    for name, section in [('Cargo.toml', '[package]'), ('Cargo.lock', '[[package]]')]:
        path = root / 'app/src-tauri' / name
        data, count = product_pattern(section).subn(lambda m: m[1] + version + m[3], path.read_text())
        if count != 1:
            raise ValueError(f'Expected exactly one product in {name}')
        updates[path] = data
    for path, data in updates.items():
        path.write_text(data)
    check('v' + version, root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('check').add_argument('--tag', required=True)
    sub.add_parser('set').add_argument('version')
    args = parser.parse_args()
    if args.command == 'check':
        print(check(args.tag))
    else:
        set_version(args.version)
