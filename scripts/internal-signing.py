#!/usr/bin/env python3
"""Stable local signing for internal builds; never modify login Keychain ACLs.
Private identity material lives only in excluded build/cache/codesign (0700).
"""
import hashlib,json,os,secrets,shutil,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'build/cache/codesign'
SECRET_VALUES=[]
def run(args):
 result=subprocess.run([str(x) for x in args],capture_output=True,text=True)
 if result.returncode:
  error=result.stderr
  for secret in SECRET_VALUES: error=error.replace(secret,'[redacted]')
  raise RuntimeError(f'{Path(args[0]).name} failed: {error[:1500]}')
 return result.stdout

def register_public_certificate(certificate):
 # Only a public certificate is registered for user-level signer discovery.
 # No private key, generic password, or SecTrustSettings entry is created here.
 import shlex
 public_root=Path.home()/'Library/Application Support/SI Assist/signing-metadata'
 if public_root.is_symlink(): raise RuntimeError('Public signer metadata must not be a symlink')
 public_root.mkdir(parents=True,exist_ok=True);os.chmod(public_root,0o700)
 public_keychain=public_root/'public-signers.keychain-db'
 if public_keychain.is_symlink(): raise RuntimeError('Public signer keychain must not be a symlink')
 if not public_keychain.exists(): run(['/usr/bin/security','create-keychain','-p','',public_keychain])
 run(['/usr/bin/security','unlock-keychain','-p','',public_keychain])
 fingerprint=hashlib.sha1(certificate.read_bytes()).hexdigest().upper()
 listed=run(['/usr/bin/security','find-certificate','-a','-Z',public_keychain])
 if fingerprint not in listed.upper(): run(['/usr/bin/security','import',certificate,'-k',public_keychain])
 paths=shlex.split(run(['/usr/bin/security','list-keychains','-d','user']))
 if str(public_keychain) not in paths: run(['/usr/bin/security','list-keychains','-d','user','-s',*paths,str(public_keychain)])
 # Public certificates remain discoverable while locked; no unlock prompt is
 # needed during app use. This store never contains private keys or passwords.
 run(['/usr/bin/security','lock-keychain',public_keychain])
 return 'user-public-certificate-only; no trust settings or credential ACL changes'

def prepare():
 if CACHE.is_symlink(): raise RuntimeError('Signing cache must not be a symlink')
 CACHE.mkdir(parents=True,exist_ok=True);os.chmod(CACHE,0o700)
 metadata=CACHE/'identity.json';keychain=CACHE/'signing.keychain-db';password_file=CACHE/'password';certificate=CACHE/'certificate.der'
 if metadata.exists():
  info=json.loads(metadata.read_text())
  if not keychain.is_file() or not password_file.is_file() or hashlib.sha1(certificate.read_bytes()).hexdigest().upper()!=info['certificateSha1']:
   raise RuntimeError('Stable signing cache is incomplete; preserve the existing identity for recovery')
 else:
  if keychain.exists() or password_file.exists(): raise RuntimeError('Incomplete signing setup exists; refusing to replace an identity silently')
  password=secrets.token_urlsafe(36);SECRET_VALUES.append(password)
  password_file.write_text(password);os.chmod(password_file,0o600)
  openssl=shutil.which('openssl')
  if not openssl: raise RuntimeError('OpenSSL is required for local internal identity creation')
  config=CACHE/'certificate.cnf';private=CACHE/'private.pem';pem=CACHE/'certificate.pem';p12=CACHE/'identity.p12'
  config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=code\nprompt=no\n[dn]\nCN=Sivio Internal Development\nO=Sivio Local Workspace\n[code]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,codeSigning\n')
  run([openssl,'req','-new','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','3650','-config',config,'-keyout',private,'-out',pem]);os.chmod(private,0o600)
  run([openssl,'x509','-in',pem,'-outform','DER','-out',certificate])
  run([openssl,'pkcs12','-export','-keypbe','PBE-SHA1-3DES','-certpbe','PBE-SHA1-3DES','-macalg','sha1','-inkey',private,'-in',pem,'-name','Sivio Internal Development','-out',p12,'-passout',f'file:{password_file}']);os.chmod(p12,0o600)
  run(['/usr/bin/security','create-keychain','-p',password,keychain])
  # Creation can add our custom keychain to the user search list. Remove only
  # our own entry from a freshly read list, preserving other concurrent entries.
  import shlex
  listed=shlex.split(run(['/usr/bin/security','list-keychains','-d','user']))
  if str(keychain) in listed: run(['/usr/bin/security','list-keychains','-d','user','-s',*[p for p in listed if p!=str(keychain)]])
  run(['/usr/bin/security','unlock-keychain','-p',password,keychain])
  run(['/usr/bin/security','set-keychain-settings','-t','3600',keychain])
  run(['/usr/bin/security','import',p12,'-k',keychain,'-P',password,'-T','/usr/bin/codesign'])
  run(['/usr/bin/security','set-key-partition-list','-S','apple-tool:,apple:,codesign:','-s','-k',password,keychain])
  info={'kind':'stable-local-self-signed','certificateSha1':hashlib.sha1(certificate.read_bytes()).hexdigest().upper(),'identityName':'Sivio Internal Development'}
  metadata.write_text(json.dumps(info,indent=2)+'\n');os.chmod(metadata,0o600)
  private.unlink();p12.unlink()
 password=password_file.read_text();SECRET_VALUES.append(password)
 run(['/usr/bin/security','unlock-keychain','-p',password,keychain])
 public_discovery=register_public_certificate(certificate)
 return {**info,'publicCertificateDiscovery':public_discovery},keychain

def sign(path,identifier='local.siassist.desktop'):
 explicit=os.environ.get('SIVIO_CODESIGN_IDENTITY')
 if explicit:
  run(['/usr/bin/codesign','--force','--options','runtime','--sign',explicit,'--preserve-metadata=entitlements',path])
  return {'kind':'explicit-identity'}
 info,keychain=prepare()
 requirement=f'designated => identifier "{identifier}" and certificate leaf = H"{info["certificateSha1"]}"'
 run(['/usr/bin/codesign','--force','--options','runtime','--sign',info['certificateSha1'],'--keychain',keychain,'--identifier',identifier,'--requirements','='+requirement,'--preserve-metadata=entitlements',path])
 run(['/usr/bin/codesign','--verify','--strict','--test-requirement','='+requirement.removeprefix('designated => '),path])
 return {**info,'designatedRequirement':requirement}
if __name__=='__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('path',nargs='?');parser.add_argument('--identifier',default='local.siassist.desktop');args=parser.parse_args()
 print(json.dumps(sign(Path(args.path),args.identifier) if args.path else prepare()[0],indent=2))
