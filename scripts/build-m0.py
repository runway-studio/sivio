#!/usr/bin/env python3
"""Build the Apple Silicon M0 engineering bundle, not the complete product."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
host=root/'experiments/m0-host'
if platform.system()!='Darwin' or platform.machine()!='arm64':
    raise SystemExit('This export script currently packages the arm64 M0 experiment only.')
env=os.environ.copy()
env.update(CARGO_HOME=str(root/'build/cache/cargo'),RUSTUP_TOOLCHAIN='1.99.0',MACOSX_DEPLOYMENT_TARGET='12.0')
env['PATH']='/usr/bin:/bin:'+env.get('PATH','')
def run(args,cwd=root):subprocess.run(args,cwd=cwd,env=env,check=True)
run([sys.executable,'scripts/preflight.py','--output','build/reports/build-preflight.json'])
run([sys.executable,'scripts/fetch-mihomo.py','--arch','aarch64-apple-darwin'])
run(['pnpm','install','--frozen-lockfile','--ignore-scripts'],host)
run(['cargo','test','--manifest-path',str(host/'src-tauri/Cargo.toml'),'--locked'])
run(['pnpm','build'],host)
source=root/'build/cache/target/release/bundle/macos/SI Assist M0.app'
output=root/'dist/m0-arm64';output.mkdir(parents=True,exist_ok=True)
run(['ditto',str(source),str(output/source.name)])
run(['codesign','--verify','--deep','--strict',str(output/source.name)])
archive=output/'SI Assist M0.zip'
run(['ditto','-c','-k','--sequesterRsrc','--keepParent',str(output/source.name),str(archive)])
print(json.dumps({'bundle':str(output/source.name),'archive':str(archive),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'scope':'M0 engineering experiment, not a complete integration release'},indent=2))
