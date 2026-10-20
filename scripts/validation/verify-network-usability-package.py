#!/usr/bin/env python3
"""Verify this scoped internal delivery and its archived implementation evidence."""
from pathlib import Path
import hashlib,json,plistlib,re,subprocess,tarfile,zipfile,tempfile
root=Path(__file__).resolve().parents[2];reports=root/'build/reports';output=root/'dist/internal-aarch64';app=output/'Sivio.app'
sha=lambda p: hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
checks=[('network-usability-ui-tests-final.log','45 passed (45)'),('network-usability-app-regression.log','33 passed (33)'),('network-usability-native.log','62 passed; 0 failed; 0 ignored'),('network-usability-helper-gate-native.log','1 passed; 0 failed'),('network-usability-vault-tests.log','8 passed; 0 failed'),('network-usability-helper-tests.log','124 passed; 0 failed; 1 ignored'),('network-usability-format-check.log','All matched files use Prettier code style!'),('network-usability-openspec.log','is valid')]
for name,needle in checks:assert needle in (reports/name).read_text(),name
assert 'error TS' not in (reports/'network-usability-typecheck-final.log').read_text()
keychain=json.loads((reports/'network-usability-keychain-identity.json').read_text())
assert keychain['stable']['requirementsStable'] and keychain['stable']['unrelatedSignerDenied'] and keychain['stable']['lockedReadDenied']
assert keychain['stable']['versions'][1]['status']==0 and keychain['adhoc']['versions'][1]['status']!=0
browser=json.loads((reports/'network-usability-browser.json').read_text());assert browser['errors']==[]
info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
assert info['CFBundleName']=='Sivio' and info['CFBundleExecutable']=='sivio-desktop' and info['CFBundleIdentifier']=='local.siassist.desktop'
exe=app/'Contents/MacOS/sivio-desktop';data=exe.read_bytes()
assert data[:4]==bytes.fromhex('cffaedfe') and int.from_bytes(data[4:8],'little')==0x0100000c
for literal in ['network core changed during delay test','Sivio 服务需要升级到 revision 12','macOS Keychain is locked or unavailable']:
 assert literal.encode() in data,literal
assert b'stop network before changing runtime settings' not in data
exe_hash=hashlib.sha256(data).hexdigest();del data
files=['app/src/App.tsx','app/src/components/shell/Sidebar.tsx','app/src/components/shell/AppPageHeader.tsx','app/src/components/network/NetworkRuntime.tsx','app/src/components/network/networkTypes.ts','app/src/components/network/networkApi.ts','app/src/components/network/NetworkWorkspace.tsx','app/src/components/network/NetworkSettingsPanel.tsx','app/src/components/network/NetworkAdvancedSettings.tsx','app/src/components/network/NetworkNodesPanel.tsx','app/src/components/network/ProxyNodeGrid.tsx','app/src/components/network/ProxyGroupNavigator.tsx','app/src/components/network/useProxyDelays.ts','app/src/components/network/proxyNodes.ts','app/src/components/network/networkText.ts','app/src-tauri/src/network/mod.rs','app/src-tauri/src/network/delay.rs','app/src-tauri/src/network/delay/tests.rs','app/src-tauri/src/credential_vault.rs','app/src-tauri/src/credential_vault/cache.rs','app/src-tauri/Cargo.toml','app/src-tauri/Cargo.lock','native/helper/src/lib.rs','native/helper/src/core/server.rs','native/helper/src/core/control_boundary.rs','scripts/build-app.py','scripts/internal-signing.py','scripts/validation/keychain-identity-probe.c','scripts/validation/test-keychain-identity.py','scripts/validation/verify-network-usability-package.py','app/tests/components/NetworkShell.test.tsx','app/tests/components/NetworkNodesPanel.test.tsx','app/tests/components/NetworkWorkspace.test.tsx']
with tarfile.open(app/'Contents/Resources/legal/sivio-corresponding-source.tar.gz') as source:
 for name in files:assert hashlib.sha256(source.extractfile(name).read()).hexdigest()==sha(root/name),name
 assert not any(n.startswith('build/') for n in source.getnames())
 assert not any(n.startswith('app/src/network-usability') for n in source.getnames())
 assert 'PROTOCOL_REVISION: u16 = 12' in source.extractfile('native/helper/src/lib.rs').read().decode()
assets='\n'.join(p.read_text() for p in (root/'app/dist/assets').glob('*.js'))
for literal in ['Pin group','Retry loading settings','Group too large; test smaller batches','Live traffic · last 60 seconds','Save and apply']:assert literal in assets,literal
assert 'fixture startup failure' not in assets and 'fixture timeout' not in assets
for name in ['clash-verge-service','clash-verge-service-install','clash-verge-service-uninstall','si-helper-control','si-network-supervisor']:
 resource=app/'Contents/Resources/network'/name
 assert sha(resource)==sha(root/'app/src-tauri/resources/network'/name),name
 data=resource.read_bytes();assert data[:4]==bytes.fromhex('cffaedfe') and int.from_bytes(data[4:8],'little')==0x0100000c,name
signing=json.loads((reports/'app-aarch64-signing-identity.json').read_text());assert signing['kind']=='stable-local-self-signed'
assert signing['publicCertificateDiscovery'].startswith('user-public-certificate-only')
subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',app],capture_output=True,text=True,check=True)
result=subprocess.run(['/usr/bin/codesign','-d','--verbose=4','-r-',app],capture_output=True,text=True,check=True)
signature_details=result.stdout+'\n'+result.stderr
assert 'Signature=adhoc' not in signature_details
assert 'runtime)' in signature_details and signing['certificateSha1'].lower() in signature_details.lower()
assert 'identifier "local.siassist.desktop"' in signature_details
(reports/'network-usability-signature-details.log').write_text(signature_details)
strict=(reports/'app-aarch64-signature.log').read_text();assert 'valid on disk' in strict and 'satisfies its Designated Requirement' in strict
archive=output/'Sivio-0.1.0-aarch64-internal.zip';artifact=json.loads((reports/'app-aarch64-artifact.json').read_text());assert sha(archive)==artifact['sha256']
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert plistlib.loads(z.read('Sivio.app/Contents/Info.plist'))==info
 assert hashlib.sha256(z.read('Sivio.app/Contents/MacOS/sivio-desktop')).hexdigest()==exe_hash
with tempfile.TemporaryDirectory(prefix='sivio-archive-check-',dir='/private/tmp') as temp:
 extracted=Path(temp)/'installed';extracted.mkdir()
 subprocess.run(['/usr/bin/ditto','-x','-k',archive,extracted],check=True,capture_output=True)
 installed=extracted/'Sivio.app'
 subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',installed],check=True,capture_output=True)
 assert sha(installed/'Contents/MacOS/sivio-desktop')==exe_hash
 plist=installed/'Contents/Info.plist';tampered=dict(info);tampered['CFBundleDisplayName']='Sivio modified validation fixture';plist.write_bytes(plistlib.dumps(tampered))
 rejected=subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',installed],capture_output=True,text=True)
 assert rejected.returncode!=0 and 'invalid Info.plist' in rejected.stderr
 (reports/'network-usability-signature-tamper.json').write_text(json.dumps({'originalDeepStrict':True,'extractedZipFreshPathDeepStrict':True,'modifiedInfoPlistRejected':True,'publicSignerKeychainLocked':True,'tamperedError':rejected.stderr.strip()},indent=2)+'\n')
update=output/'Sivio-0.1.0-aarch64.app.tar.gz';assert sha(update)==artifact['updaterSha256']
with tarfile.open(update) as t:assert hashlib.file_digest(t.extractfile('Sivio.app/Contents/MacOS/sivio-desktop'),'sha256').hexdigest()==exe_hash
report={'product':'Sivio','app':str(app.relative_to(root)),'zip':str(archive.relative_to(root)),'zipSha256':artifact['sha256'],'updaterSha256':artifact['updaterSha256'],'executableSha256':exe_hash,'architecture':'aarch64','signing':signing,'hardenedRuntime':True,'notarized':False,'serviceRevision':12,'sourceSha256':{name:sha(root/name) for name in files},'validation':{'uiTargeted':45,'appAndTrayRegression':33,'nativeNetwork':62,'nativeHelperCompatibilityGate':1,'vault':8,'helperPassed':124,'helperExistingIgnored':1,'typecheck':'passed','scopedFormat':'passed','openspec':'passed','isolatedKeychain':'passed; changed signed binaries allowed, adhoc/unrelated/locked denied without interaction','browser':'passed; actual components, synthetic IPC','archiveIntegrity':'passed; extracted ZIP strict signature at fresh path; tampered Info.plist rejected','criticalSourceMatchesWorkspace':True,'privateSigningCacheAndDevelopmentFixtureExcluded':True},'limits':['No physical native window movement test; drag targets verified in browser and components.','Existing login Keychain items and installed revision12 helper/TUN upgrade were not exercised.','Old adhoc entries may need a user Always Allow decision; no permissions weakened.','Internal Apple Silicon build; not notarized; full original proposal/Intel physical acceptance not passed.']}
(reports/'network-usability-packages-verified.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['app','zip','architecture','serviceRevision','hardenedRuntime','notarized']},ensure_ascii=False,indent=2))
print('Verified',len(files),'source files, stable signing, private-material exclusions, ZIP/TAR and all scoped evidence.')
