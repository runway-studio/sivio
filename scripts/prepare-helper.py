#!/usr/bin/env python3
"""Prepare an isolated helper fork, preserving upstream and a reproducible patch."""
from pathlib import Path
import difflib
import hashlib
import json
import shutil

root=Path(__file__).resolve().parents[1]
source=root/'vendor/upstream/clash-verge-service-ipc'
target=root/'native/helper'
if target.exists(): raise SystemExit('native/helper already exists; refusing to overwrite local work')
shutil.copytree(source,target)
patches=[]
for name in ['src/channel.rs','src/lib.rs','src/core/paths.rs','src/bin/install_service.rs','src/bin/shared/mod.rs']:
    f=target/name;original=f.read_text();updated=original
    updated=updated.replace('io.github.clash-verge-rev.clash-verge-rev','local.siassist.desktop')
    updated=updated.replace('/var/run/clash-verge-service','/var/run/si-assist-service')
    updated=updated.replace('service_slug: "clash-verge-service','service_slug: "si-assist-service')
    updated=updated.replace('service_display_name: "Clash Verge Service"','service_display_name: "Sivio Service"')
    updated=updated.replace('service_display_name: "Clash Verge Development Service"','service_display_name: "Sivio Development Service"')
    if name=='src/channel.rs':updated=updated.replace('service_slug.starts_with("clash-verge-service")','service_slug.starts_with("si-assist-service")')
    if name=='src/bin/shared/mod.rs':
        a=updated.index('pub fn uninstall_old_service()');b=updated.index('\n#[cfg(',a)
        updated=updated[:a]+'''pub fn uninstall_old_service() -> Result<(), Error> {
    // A Sivio install must never remove another application's helper.
    Ok(())
}
'''+updated[b:]
    if updated!=original:
        f.write_text(updated)
        patches.extend(difflib.unified_diff(original.splitlines(True),updated.splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(root/'native/patches').mkdir(parents=True,exist_ok=True)
patch=root/'native/patches/helper-identity.patch';patch.write_text(''.join(patches))
report={'sourceCommit':'b2a7427d6681c8d3780ab83a73f4dc21da2f22d6','patch':'native/patches/helper-identity.patch','patchSha256':hashlib.sha256(patch.read_bytes()).hexdigest(),'bundleId':'local.siassist.desktop','serviceId':'local.siassist.desktop.service','ipcPath':'/var/run/si-assist-service/service.sock','status':'source-prepared; not installed or runtime-verified'}
(root/'build/reports/helper-port.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
