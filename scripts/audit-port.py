#!/usr/bin/env python3
"""File-level source provenance. This is not a claim of operation-level parity."""
from pathlib import Path
import hashlib,json,difflib
ROOT=Path(__file__).resolve().parents[1]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
records=[]
for label,upstream,ported,trees in [('cc-business','vendor/upstream/cc-switch','app',['src','src-tauri/src']),('helper','vendor/upstream/clash-verge-service-ipc','native/helper',['src'])]:
 old=ROOT/upstream;new=ROOT/ported;patch=[]
 for tree in trees:
  files=sorted({p.relative_to(old) for p in (old/tree).rglob('*') if p.is_file()} | {p.relative_to(new) for p in (new/tree).rglob('*') if p.is_file()})
  for path in files:
   before=old/path;after=new/path;oldhash=sha(before) if before.is_file() else None;newhash=sha(after) if after.is_file() else None
   if oldhash==newhash:continue
   records.append(dict(domain=label,path=str(Path(ported)/path),status='added' if oldhash is None else 'removed' if newhash is None else 'modified',upstreamSha256=oldhash,currentSha256=newhash))
   try:
    a=before.read_text().splitlines(keepends=True) if oldhash else [];b=after.read_text().splitlines(keepends=True) if newhash else []
    patch.extend(difflib.unified_diff(a,b,fromfile=str(Path(upstream)/path),tofile=str(Path(ported)/path)))
   except UnicodeDecodeError:pass
 patchdir=ROOT/'docs/implementation/patches';patchdir.mkdir(exist_ok=True);(patchdir/f'{label}-source.patch').write_text(''.join(patch))
report={'scope':'source-file provenance only; full UI/settings parity is a separate acceptance gate','records':records,'portedSources':{'app/src-tauri/src/network/enhance':'Clash Verge Rev 4337bd85758d54d7b9044b2da3c9ac1176eae1f3 src-tauri/src/enhance','app/src-tauri/src/network/media':'Clash Verge Rev 4337bd85758d54d7b9044b2da3c9ac1176eae1f3 crates/clash-verge-media-unlock/src; bounded responses, local job cancellation and logging adapted'}}
(ROOT/'build/reports/port-source-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(f'{len(records)} changed/added/removed source files recorded')
