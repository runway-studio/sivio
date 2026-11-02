#!/usr/bin/env python3
"""Collect installed dependency notices without downloading or exposing host paths."""
import argparse, hashlib, json, os, re, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--target',default='aarch64-apple-darwin');args=parser.parse_args()
    destination=ROOT/'app/src-tauri/resources/legal/dependencies'
    if destination.exists():shutil.rmtree(destination)
    destination.mkdir(parents=True)
    env=os.environ.copy();env.update(CARGO_HOME=str(ROOT/'build/cache/cargo'),RUSTUP_TOOLCHAIN='1.99.0')
    records={}
    def collect(ecosystem,name,version,license_name,path,license_file=None):
        identity=f'{ecosystem}:{name}@{version}'
        if identity in records:return
        folder=re.sub(r'[^a-zA-Z0-9._-]','_',identity)
        files=[p for p in path.iterdir() if p.is_file() and re.match(r'(?i)^(licen[sc]e|copying|copyright|notice)([.\-_]|$)',p.name)]
        if license_file:
            extra=path/license_file
            if extra.is_file() and extra not in files:files.append(extra)
        cached=ROOT/'vendor/dependency-notices'/folder
        if not cached.is_dir():cached=ROOT/'build/cache/dependency-notices'/folder
        if cached.is_dir():files += [p for p in cached.iterdir() if p.is_file() and p.name!='source.json']
        if not files and path.is_relative_to(ROOT) and license_name=='GPL-3.0-only':files=[ROOT/'LICENSE']
        notices=[]
        for source in sorted(files):
            if source.stat().st_size>2*1024*1024:continue
            target=destination/folder/source.name;target.parent.mkdir(exist_ok=True)
            shutil.copyfile(source,target)
            notices.append({'file':str(target.relative_to(destination)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        records[identity]={'ecosystem':ecosystem,'name':name,'version':version,'license':license_name or 'UNDECLARED','notices':notices,'noticeSources':json.loads((cached/'source.json').read_text()) if (cached/'source.json').is_file() else None}
    for manifest in ['app/src-tauri/Cargo.toml','native/helper/Cargo.toml','native/supervisor/Cargo.toml']:
        command=['cargo','metadata','--offline','--format-version','1','--manifest-path',manifest,'--filter-platform',args.target]
        if manifest.startswith('native/helper'):command+=['--features','standalone,client']
        result=json.loads(subprocess.check_output(command,cwd=ROOT,env=env))
        for package in result['packages']:
            collect('cargo',package['name'],package['version'],package.get('license'),Path(package['manifest_path']).parent,package.get('license_file'))
    tree=json.loads(subprocess.check_output(['pnpm','list','--prod','--depth','Infinity','--json'],cwd=ROOT/'app',stderr=subprocess.PIPE))
    def visit(item):
        for group in ['dependencies','optionalDependencies']:
            for name,package in item.get(group,{}).items():
                path=Path(package['path'])
                metadata=json.loads((path/'package.json').read_text())
                license_name=metadata.get('license',metadata.get('licenses'))
                if not isinstance(license_name,str):license_name=json.dumps(license_name,ensure_ascii=False) if license_name else None
                collect('npm',metadata.get('name',name),metadata['version'],license_name,path)
                visit(package)
    for item in tree:visit(item)
    values=sorted(records.values(),key=lambda r:(r['ecosystem'],r['name'],r['version']))
    report={'scope':'Installed Rust packages for the application/helper/supervisor and production frontend dependencies; declared licenses and available notice files. This is an inventory, not legal clearance.','packages':values,'missingDeclarations':[f"{r['ecosystem']}:{r['name']}@{r['version']}" for r in values if r['license']=='UNDECLARED'],'missingNoticeFiles':[f"{r['ecosystem']}:{r['name']}@{r['version']}" for r in values if not r['notices']]}
    (destination/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'build/reports/dependency-license-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'packages':len(values),'missingDeclarations':len(report['missingDeclarations']),'missingNoticeFiles':len(report['missingNoticeFiles'])}))
if __name__=='__main__':main()
