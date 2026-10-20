#!/usr/bin/env python3
"""Resolve notice files omitted from installed packages, using fixed source refs."""
import concurrent.futures,json,os,re,subprocess,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ENV=os.environ.copy();ENV.update(CARGO_HOME=str(ROOT/'build/cache/cargo'),RUSTUP_TOOLCHAIN='1.99.0')
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Sivio-license-audit/0.1'}),timeout=8) as response:
        data=response.read(2*1024*1024+1)
        if len(data)>2*1024*1024:raise ValueError('notice exceeds limit')
        return data
def main():
    report=json.loads((ROOT/'build/reports/dependency-license-audit.json').read_text())
    missing=set(report['missingNoticeFiles']);plans={}
    for manifest in ['app/src-tauri/Cargo.toml','native/helper/Cargo.toml','native/supervisor/Cargo.toml']:
        command=['cargo','metadata','--offline','--format-version','1','--manifest-path',manifest,'--filter-platform','aarch64-apple-darwin']
        if 'native/helper' in manifest:command+=['--features','standalone,client']
        for package in json.loads(subprocess.check_output(command,cwd=ROOT,env=ENV,stderr=subprocess.PIPE))['packages']:
            identity=f"cargo:{package['name']}@{package['version']}"
            if identity not in missing:continue
            info=Path(package['manifest_path']).parent/'.cargo_vcs_info.json'
            commit=json.loads(info.read_text()).get('git',{}).get('sha1') if info.exists() else None
            plans[identity]=(package.get('repository'),[commit] if commit else ['v'+package['version'],package['version']])
    for identity in missing:
        if identity.startswith('npm:'):plans[identity]=(None,None)
    def fetch(item):
        identity,(repository,refs)=item
        try:
            if identity.startswith('npm:'):
                name,version=identity[4:].rsplit('@',1)
                package=json.loads(get('https://registry.npmjs.org/'+urllib.parse.quote(name,safe='')+'/'+version))
                repository=package.get('repository');repository=repository.get('url') if isinstance(repository,dict) else repository
                refs=[package['gitHead']] if package.get('gitHead') else ['v'+version,version]
            if not repository:return identity,'missing repository'
            repository=repository.removeprefix('git+').replace('git://','https://').removesuffix('.git')
            parsed=urllib.parse.urlparse(repository)
            if parsed.hostname!='github.com':return identity,'non-GitHub source requires manual review'
            parts=parsed.path.strip('/').split('/')
            if len(parts)<2:return identity,'invalid repository'
            base='https://raw.githubusercontent.com/'+'/'.join(parts[:2])
            for ref in refs:
                for name in ['LICENSE','LICENSE.md','LICENSE-MIT','LICENSE_MIT','LICENSE-MPL','LICENSE-MPL-2.0','LICENSE.txt','COPYING','license','license.txt','license.md']:
                    source=base+'/'+ref+'/'+name
                    try:
                        data=get(source);data.decode('utf-8')
                        folder=ROOT/'build/cache/dependency-notices'/re.sub(r'[^a-zA-Z0-9._-]','_',identity);folder.mkdir(parents=True,exist_ok=True)
                        (folder/name).write_bytes(data)
                        (folder/'source.json').write_text(json.dumps({'package':identity,'url':source,'ref':ref},indent=2)+'\n')
                        return identity,'resolved'
                    except Exception:pass
            return identity,'notice not found at source ref'
        except Exception as error:return identity,type(error).__name__
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=dict(pool.map(fetch,plans.items()))
    (ROOT/'build/reports/dependency-notice-fetch.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps({'resolved':sum(v=='resolved' for v in results.values()),'pending':sum(v!='resolved' for v in results.values())}))
if __name__=='__main__':main()
