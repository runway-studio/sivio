#!/usr/bin/env python3
"""Prove stable DR reads across changed builds without enabling Keychain UI."""
import importlib.util,json,os,secrets,shlex,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('internal_signing',ROOT/'scripts/internal-signing.py');signing=importlib.util.module_from_spec(spec);spec.loader.exec_module(signing)
with tempfile.TemporaryDirectory(prefix='sivio-keychain-',dir='/private/tmp') as temp:
 temp=Path(temp);results={}
 for stable in [False,True]:
  keychain=temp/('stable.keychain-db' if stable else 'adhoc.keychain-db');probe=temp/'credential-probe';password=secrets.token_urlsafe(30);signing.SECRET_VALUES.append(password)
  try:
   signing.run(['/usr/bin/security','create-keychain','-p',password,keychain])
   listed=shlex.split(signing.run(['/usr/bin/security','list-keychains','-d','user']))
   if str(keychain) in listed:signing.run(['/usr/bin/security','list-keychains','-d','user','-s',*[p for p in listed if p!=str(keychain)]])
   signing.run(['/usr/bin/security','unlock-keychain','-p',password,keychain])
   versions=[];requirements=[]
   for version in [1,2]:
    signing.run(['/usr/bin/clang','-Wno-deprecated-declarations',f'-DVERSION={version}',ROOT/'scripts/validation/keychain-identity-probe.c','-framework','Security','-framework','CoreFoundation','-o',probe])
    if stable: signing.sign(probe,'local.sivio.isolated-probe')
    else: signing.run(['/usr/bin/codesign','--force','--sign','-','--identifier','local.sivio.isolated-probe',probe])
    detail_result=subprocess.run(['/usr/bin/codesign','-d','-r-',probe],capture_output=True,text=True)
    details=detail_result.stdout+'\n'+detail_result.stderr
    requirements.append(next((line for line in details.splitlines() if 'designated =>' in line),''))
    mode='create' if version==1 else 'read'
    versions.append(json.loads(signing.run([probe,mode,keychain])))
   assert versions[0]['status']==0,versions
   if stable:
    assert versions[1]['status']==0,versions
    assert requirements[0]==requirements[1]
   else:
    assert versions[1]['status']!=0,versions
    assert requirements[0]!=requirements[1]
   unrelated_denied=None
   if stable:
    signing.run(['/usr/bin/codesign','--force','--sign','-','--identifier','local.sivio.isolated-probe',probe])
    unrelated=json.loads(signing.run([probe,'read',keychain]))
    assert unrelated['status']!=0
    unrelated_denied=True
   locked=json.loads(signing.run([probe,'lock',keychain]))
   assert locked['status']==0 and not locked['unlocked']
   locked_read=json.loads(signing.run([probe,'read',keychain]))
   assert locked_read['status']!=0
   results['stable' if stable else 'adhoc']={'versions':versions,'requirementsStable':requirements[0]==requirements[1],'interactionAllowed':False,'lockedReadDenied':locked_read['status']!=0,'unrelatedSignerDenied':unrelated_denied}
  finally:
   if keychain.exists():signing.run(['/usr/bin/security','delete-keychain',keychain])
 (ROOT/'build/reports/network-usability-keychain-identity.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(results,indent=2))
