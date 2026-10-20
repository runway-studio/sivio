#!/usr/bin/env python3
"""Build the real Sivio single-host application with fixed network resources."""
import argparse,gzip,hashlib,json,os,shutil,subprocess,tarfile,time,importlib.util,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def call(args,log,env,cwd=ROOT):
 with (ROOT/'build/reports'/log).open('w') as output:
  subprocess.run(args,cwd=cwd,env=env,stdout=output,stderr=subprocess.STDOUT,check=True)
def copy_versioned_bundle(source,output):
 """Never overwrite a shipped bundle: macOS validates live code against its files.

 Even an atomic replacement invalidates a process running the previous bundle.
 Keep each build at its own immutable path, regardless of whether it is running.
 """
 build_id=time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]
 destination=output/'builds'/build_id/source.name
 destination.parent.mkdir(parents=True,exist_ok=False)
 shutil.copytree(source,destination,symlinks=True)
 return destination
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--arch',choices=['aarch64','x86_64'],default='aarch64');parser.add_argument('--skip-helper-build',action='store_true');args=parser.parse_args()
 target=f'{args.arch}-apple-darwin';env=os.environ.copy();env.update(CARGO_HOME=str(ROOT/'build/cache/cargo'),RUSTUP_TOOLCHAIN='1.99.0',MACOSX_DEPLOYMENT_TARGET='12.0',PATH='/usr/bin:/bin:/opt/homebrew/bin:'+env.get('PATH',''))
 resources=ROOT/'app/src-tauri/resources';net=resources/'network';legal=resources/'legal';net.mkdir(parents=True,exist_ok=True);legal.mkdir(parents=True,exist_ok=True)
 if not args.skip_helper_build:
  call(['cargo','build','--manifest-path','native/helper/Cargo.toml','--features','standalone,client','--bins']+(['--target',target] if args.arch!='aarch64' else []),f'helper-{args.arch}-package.log',env)
 helpers=ROOT/'build/cache/target'/(target if args.arch!='aarch64' else '')/'debug'
 for name in ['clash-verge-service','clash-verge-service-install','clash-verge-service-uninstall','si-helper-control']:
  shutil.copy2(helpers/name,net/name)
  identifier='local.siassist.validation' if name=='si-helper-control' else 'local.siassist.'+name
  subprocess.run(['/usr/bin/codesign','--force','--sign','-','--identifier',identifier,str(net/name)],check=True,capture_output=True)
 call(['cargo','build','--manifest-path','native/supervisor/Cargo.toml']+(['--target',target] if args.arch!='aarch64' else []),f'supervisor-{args.arch}-package.log',env)
 supervisor=ROOT/'build/cache/target'/(target if args.arch!='aarch64' else '')/'debug/si-network-supervisor'
 shutil.copy2(supervisor,net/'si-network-supervisor')
 subprocess.run(['/usr/bin/codesign','--force','--sign','-','--identifier','local.siassist.supervisor',str(net/'si-network-supervisor')],check=True,capture_output=True)
 for channel,name in [('stable','mihomo'),('alpha','mihomo-alpha')]:
  base=ROOT/'build/cache/mihomo'/target/channel;archive=next(base.glob('*.gz'));shutil.copy2(archive,net/(name+'.gz'))
  shutil.copy2(base/'verification.json',net/(name+'-verification.json'))
 for origin,license in [('cc-switch','LICENSE'),('clash-verge-rev','LICENSE'),('clash-verge-service-ipc','LICENSE'),('mihomo-stable','LICENSE'),('mihomo-alpha','LICENSE')]:
  shutil.copy2(ROOT/'vendor/upstream'/origin/license,legal/(origin+'-LICENSE'))
 shutil.copy2(ROOT/'docs/implementation/THIRD-PARTY-NOTICES.md',legal/'THIRD-PARTY-NOTICES.md')
 call(['cargo','fetch','--manifest-path','app/src-tauri/Cargo.toml','--target',target],f'app-{args.arch}-dependencies.log',env)
 call(['python3','scripts/collect-dependency-licenses.py','--target',target],f'licenses-{args.arch}-package.log',env)
 shutil.copy2(ROOT/'docs/implementation/mihomo-source-manifest.json',legal/'mihomo-source-manifest.json')
 # Do not ship the previous generated source archive alongside the current one.
 (legal/'si-assist-corresponding-source.tar.gz').unlink(missing_ok=True)
 with tarfile.open(legal/'sivio-corresponding-source.tar.gz','w:gz') as archive:
  for folder in ['app','native','scripts','openspec','docs/implementation','vendor/upstream']:
   def include(info):
    excluded={'node_modules','.git','target','dist','resources','__pycache__'}
    return None if excluded.intersection(Path(info.name).parts) else info
   archive.add(ROOT/folder,arcname=folder,filter=include)
  for file in ['README.md','LICENSE','.cargo/config.toml','.gitignore']:archive.add(ROOT/file,arcname=file)
 config=json.loads((ROOT/'app/src-tauri/tauri.conf.json').read_text());config['bundle']['resources']={'resources/network/':'network/','resources/legal/':'legal/'}
 (ROOT/'app/src-tauri/tauri.conf.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
 call(['pnpm','tauri','build','--debug','--features','custom-protocol','--bundles','app']+(['--target',target] if args.arch!='aarch64' else []),f'app-{args.arch}-package.log',env,ROOT/'app')
 product=config['productName'];version=config['version']
 source=ROOT/'build/cache/target'/(target if args.arch!='aarch64' else '')/'debug/bundle/macos'/f'{product}.app';output=ROOT/'dist'/f'internal-{args.arch}'
 destination=copy_versioned_bundle(source,output)
 signing_spec=importlib.util.spec_from_file_location('sivio_internal_signing',ROOT/'scripts/internal-signing.py')
 signing_module=importlib.util.module_from_spec(signing_spec);signing_spec.loader.exec_module(signing_module)
 signing_info=signing_module.sign(destination,config['identifier'])
 (ROOT/'build/reports'/f'app-{args.arch}-signing-identity.json').write_text(json.dumps(signing_info,indent=2)+'\n')
 call(['/usr/bin/codesign','--verify','--deep','--strict','--verbose=2',str(destination)],f'app-{args.arch}-signature.log',env)
 zip_path=output/f'{product}-{version}-{args.arch}-internal.zip'
 zip_staging=destination.parent/(zip_path.name+'.tmp')
 subprocess.run(['/usr/bin/ditto','-c','-k','--sequesterRsrc','--keepParent',str(destination),str(zip_staging)],check=True)
 zip_staging.replace(zip_path)
 update_path=output/f'{product}-{version}-{args.arch}.app.tar.gz'
 update_staging=destination.parent/(update_path.name+'.tmp')
 with tarfile.open(update_staging,'w:gz') as archive:archive.add(destination,arcname=destination.name)
 update_staging.replace(update_path)
 report={'app':str(destination.relative_to(ROOT)),'archive':str(zip_path.relative_to(ROOT)),'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest(),'updaterArtifact':str(update_path.relative_to(ROOT)),'updaterSha256':hashlib.sha256(update_path.read_bytes()).hexdigest(),'updaterSignature':'not-generated; own channel remains unconfigured','architecture':args.arch,'frontendProtocol':'custom-protocol (embedded assets)','frontendEntrySha256':hashlib.sha256((ROOT/'app/dist/index.html').read_bytes()).hexdigest(),'signing':signing_info['kind'],'notarized':False,'fullAcceptance':'not-passed','intelPhysicalAcceptance':'not-passed','builtAt':time.time()}
 (ROOT/'build/reports'/f'app-{args.arch}-artifact.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
