#!/usr/bin/env python3
"""Read-only macOS build prerequisites for the approved Sivio proposal."""
import argparse
import json
import os
import platform
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def command(*args):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return {'command': list(args), 'exitCode': r.returncode,
                'output': (r.stdout + r.stderr).strip()}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {'command': list(args), 'exitCode': -1, 'output': str(e)}

def inspect_build():
    free = shutil.disk_usage(ROOT).free
    checks = []
    def add(name, passed, detail):
        checks.append({'name': name, 'passed': passed, 'detail': detail})
    add('macOS host', platform.system() == 'Darwin', platform.platform())
    add('build volume writable', os.access(ROOT, os.W_OK), {'availableBytes': free})
    toolchain = command('rustup', 'run', '1.99.0', 'rustc', '--version')
    add('pinned Rust 1.99.0 installed', toolchain['exitCode'] == 0, toolchain)
    for name in ['node', 'pnpm', 'clang', 'codesign', 'iconutil']:
        add(name + ' available', shutil.which(name) is not None, shutil.which(name))
    sdk = command('xcrun', '--sdk', 'macosx', '--show-sdk-path')
    add('macOS SDK available', sdk['exitCode'] == 0, sdk)
    return {'status': 'ready' if all(x['passed'] for x in checks) else 'blocked',
            'checks': checks,
            'warnings': ['Less than the recommended 20 GiB build headroom; monitor actual compilation space.'] if free < 20 * 1024**3 else [],
            'scope': 'Build prerequisites only; does not certify M0, runtime, signing or feature parity.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = inspect_build()
    content = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content)
    print(content)
    raise SystemExit(0 if report['status'] == 'ready' else 1)
