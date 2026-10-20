#!/usr/bin/env python3
"""Fetch source for the exact bundled core revisions, never a floating branch."""
import urllib.request,json,hashlib,tarfile,tempfile,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
records=[]
for channel,ref in [('stable','v1.19.32'),('alpha','94b13ae')]:
 req=urllib.request.Request(f'https://api.github.com/repos/MetaCubeX/mihomo/commits/{ref}',headers={'User-Agent':'Sivio-source-bundle'})
 with urllib.request.urlopen(req,timeout=60) as response:sha=json.load(response)['sha']
 assert len(sha)==40 and (channel!='alpha' or sha.startswith(ref))
 dest=ROOT/'vendor/upstream'/f'mihomo-{channel}'
 if dest.exists(): raise RuntimeError(f'Refusing to replace existing source: {dest}')
 url=f'https://codeload.github.com/MetaCubeX/mihomo/tar.gz/{sha}'
 with urllib.request.urlopen(url,timeout=90) as response:data=response.read(128*1024*1024+1)
 if len(data)>128*1024*1024:raise RuntimeError('source exceeds limit')
 archive=ROOT/'build/cache/mihomo'/f'{channel}-{sha}-source.tar.gz';archive.write_bytes(data)
 with tempfile.TemporaryDirectory(dir=ROOT/'build/cache') as tmp:
  with tarfile.open(archive) as tar:tar.extractall(tmp,filter='data')
  folders=list(Path(tmp).iterdir());assert len(folders)==1;shutil.move(str(folders[0]),dest)
 records.append(dict(channel=channel,revision=sha,ref=ref,url=url,sourceArchiveSha256=hashlib.sha256(data).hexdigest()))
manifest=ROOT/'docs/implementation/mihomo-source-manifest.json';manifest.write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2))
