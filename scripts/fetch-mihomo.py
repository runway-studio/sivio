#!/usr/bin/env python3
"""Fetch a digest-pinned Mihomo artifact from the reviewed manifest."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--arch', choices=['aarch64-apple-darwin','x86_64-apple-darwin'], required=True)
parser.add_argument('--channel', choices=['stable','alpha'], default='stable')
parser.add_argument('--cache-root', type=Path, default=root/'build/cache/mihomo')
args = parser.parse_args()
manifest = json.loads((root/'build/reports/upstream-manifest.json').read_text())
asset = next(x for x in manifest['kernels'] if x['architecture']==args.arch and x['channel']==args.channel)
expected = asset['sha256']
if not expected or not expected.startswith('sha256:'): raise SystemExit('Pinned digest is required')
cache = args.cache_root/args.arch/args.channel
cache.mkdir(parents=True, exist_ok=True)
archive = cache/asset['filename']
if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest()!=expected[7:]:
    if asset.get('vendoredPath'):
        pinned = (root/asset['vendoredPath']).resolve()
        if not pinned.is_relative_to(root/'vendor/cores'):
            raise ValueError('Vendored artifact must be inside vendor/cores')
        source = pinned.open('rb')
    else:
        request = urllib.request.Request(asset['url'], headers={'User-Agent':'Sivio-build'})
        source = urllib.request.urlopen(request, timeout=60)
    with source, tempfile.NamedTemporaryFile(dir=cache,delete=False) as out:
        temp = Path(out.name)
        try:
            digest = hashlib.sha256(); total=0
            while block:=source.read(1024*1024):
                total+=len(block)
                if total>asset['size']: raise ValueError('Artifact exceeds pinned size')
                digest.update(block);out.write(block)
            if total!=asset['size'] or digest.hexdigest()!=expected[7:]: raise ValueError('Artifact digest or size mismatch')
            out.close();os.replace(temp,archive)
        finally:
            temp.unlink(missing_ok=True)
binary=cache/'mihomo'
with gzip.open(archive,'rb') as source, tempfile.NamedTemporaryFile(dir=cache,delete=False) as out:
    temp=Path(out.name)
    try:
        total=0
        while block:=source.read(1024*1024):
            total+=len(block)
            if total>256*1024*1024: raise ValueError('Unpacked artifact exceeds 256 MiB')
            out.write(block)
        out.close();os.chmod(temp,0o755);os.replace(temp,binary)
    finally:
        temp.unlink(missing_ok=True)
report={**asset,'verification':'download size and SHA256 matched pinned publisher digest','binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest()}
(cache/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(binary)
