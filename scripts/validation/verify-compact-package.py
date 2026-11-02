#!/usr/bin/env python3
"""Verify compact packaging, exact source, signing and both offline proxy cores."""
import hashlib, http.server, json, lzma, os, socket, struct, subprocess, tarfile, tempfile, threading, time, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / 'build/reports'
def sha(path):
    with path.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
def command(*args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True)
def identity(path):
    p = command('/usr/bin/codesign', '-d', '-r-', path)
    return next(line for line in (p.stdout + '\n' + p.stderr).splitlines() if line.startswith('designated =>'))
def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'offline-proxy-proof'
        self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *args): pass

def main():
    artifact = json.loads((REPORTS / 'app-aarch64-artifact.json').read_text())
    baseline = json.loads((REPORTS / 'app-size-80/baseline.json').read_text())
    app = ROOT / artifact['app']; old = ROOT / baseline['app']
    resources = app / 'Contents/Resources'; net = resources / 'network'
    assert artifact['buildProfile'] == 'release'
    size = sum(p.stat().st_size for p in app.rglob('*') if p.is_file())
    assert size <= 80_000_000, f'App exceeds 80 MB: {size}'
    assert not list(resources.rglob('*source*.tar.gz'))
    assert not (net / 'mihomo.gz').exists() and not (net / 'mihomo-alpha.gz').exists()
    old_resources = old / 'Contents/Resources'
    removed = {'network/mihomo.gz', 'network/mihomo-alpha.gz', 'legal/sivio-corresponding-source.tar.gz'}
    modified = {'legal/THIRD-PARTY-NOTICES.md', 'legal/dependencies/manifest.json'}
    retained = 0
    for path in old_resources.rglob('*'):
        if not path.is_file(): continue
        relative = path.relative_to(old_resources).as_posix()
        if relative in removed: continue
        new = resources / relative
        assert new.is_file(), relative
        if relative not in modified: assert sha(path) == sha(new), relative
        retained += 1
    assert artifact['frontendEntrySha256'] == baseline['frontendEntrySha256']
    assert identity(app) == identity(old)
    command('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    links = command('/usr/bin/otool', '-L', app / 'Contents/MacOS/sivio-desktop').stdout
    assert '/opt/homebrew/' not in links and '/usr/local/' not in links
    source = ROOT / artifact['sourceArchive']
    assert sha(source) == artifact['sourceSha256']
    notice = (resources / 'legal/SOURCE.txt').read_text()
    assert source.name in notice and artifact['sourceSha256'] in notice
    source_count = 0
    with tarfile.open(source) as tar:
        for member in tar.getmembers():
            if member.isfile():
                assert tar.extractfile(member).read() == (ROOT / member.name).read_bytes(), member.name
                source_count += 1
    archive = ROOT / artifact['archive']
    assert sha(archive) == artifact['sha256']
    with zipfile.ZipFile(archive) as z: assert z.testzip() is None
    with tempfile.TemporaryDirectory(prefix='sivio-compact-zip-', dir='/private/tmp') as temp:
        command('/usr/bin/ditto', '-x', '-k', archive, temp)
        installed = Path(temp) / 'Sivio.app'
        command('/usr/bin/codesign', '--verify', '--deep', '--strict', installed)
        assert identity(installed) == identity(old)
    update = ROOT / artifact['updaterArtifact']; assert sha(update) == artifact['updaterSha256']
    started = time.monotonic(); raw = lzma.decompress((net / 'mihomo-cores.xz').read_bytes())
    decompress_seconds = time.monotonic() - started
    assert raw[:8] == b'SIVCORE1'
    sizes = struct.unpack('<QQ', raw[8:24]); assert sum(sizes) + 24 == len(raw)
    cores = [raw[24:24 + sizes[0]], raw[24 + sizes[0]:]]
    results = []
    upstream = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    try:
        for (channel, name), data in zip([('stable', 'mihomo'), ('alpha', 'mihomo-alpha')], cores):
            verification = json.loads((net / f'{name}-verification.json').read_text())
            assert hashlib.sha256(data).hexdigest() == verification['binarySha256']
            with tempfile.TemporaryDirectory(prefix='sivio-compact-core-', dir='/private/tmp') as temp:
                temp = Path(temp); runtime = temp / 'runtime'; control = temp / 'control'
                runtime.mkdir(mode=0o700); control.mkdir(mode=0o700)
                core = temp / name; core.write_bytes(data); core.chmod(0o700)
                sock = control / 'core.sock'; port = free_port()
                (runtime / 'config.yaml').write_text(f'mixed-port: {port}\nbind-address: 127.0.0.1\nallow-lan: false\nmode: rule\nexternal-controller-unix: {sock}\ndns: {{enable: false}}\ntun: {{enable: false}}\nrules: ["MATCH,DIRECT"]\n')
                env = dict(os.environ, SI_ASSIST_CONTROL_DIRECTORY=str(control))
                process = subprocess.Popen([str(net / 'si-network-supervisor'), str(core), str(runtime), channel], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    deadline = time.monotonic() + 30
                    while time.monotonic() < deadline:
                        probe = subprocess.run(['curl', '--unix-socket', str(sock), '--max-time', '1', '-fsS', 'http://localhost/version'], capture_output=True, text=True)
                        if probe.returncode == 0: break
                        if process.poll() is not None: raise RuntimeError(process.stderr.read().decode())
                        time.sleep(.05)
                    assert probe.returncode == 0, probe.stderr
                    version = json.loads(probe.stdout)
                    response = command('curl', '--proxy', f'http://127.0.0.1:{port}', '--noproxy', '', '--max-time', '5', '-fsS', f'http://127.0.0.1:{upstream.server_port}/proof')
                    assert response.stdout == 'offline-proxy-proof'
                    process.stdin.close(); process.wait(timeout=5); assert process.returncode == 0
                    probe = subprocess.run(['curl', '--unix-socket', str(sock), '--max-time', '1', '-fsS', 'http://localhost/version'], capture_output=True)
                    assert probe.returncode != 0
                    results.append({'channel': channel, 'version': version, 'offlineProxyTraffic': 'passed', 'sandboxedStartAndShutdown': 'passed'})
                finally:
                    if process.poll() is None:
                        if not process.stdin.closed: process.stdin.close()
                        process.wait(timeout=5)
                    process.stdout.close(); process.stderr.close()
    finally:
        upstream.shutdown(); upstream.server_close()
    report = {'app': str(app), 'archive': str(archive), 'sourceArchive': str(source), 'appMB': size / 1_000_000, 'appMiB': size / 1048576, 'zipMB': archive.stat().st_size / 1_000_000, 'sourceMiB': source.stat().st_size / 1048576, 'unchangedFrontend': True, 'retainedResourceFiles': retained, 'matchingSourceFiles': source_count, 'signatureAndExtractedZip': 'passed', 'sameSigningIdentity': True, 'offlineCoreTests': results, 'xzDecodeSeconds': decompress_seconds, 'sourceSha256': artifact['sourceSha256'], 'zipSha256': artifact['sha256']}
    (REPORTS / 'app-size-80/verified.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False, indent=2))
if __name__ == '__main__': main()
