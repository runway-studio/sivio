"""Build and verify a drag-to-Applications image from the final signed App."""
import hashlib
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

INSTALL = '''Sivio 安装 / Installation

1. 完全退出正在运行的旧版 Sivio，再将 Sivio.app 拖到 Applications。
2. 等待复制完成，推出此磁盘映像，从“应用程序”打开 Sivio。
3. 本版使用内部签名，未经过 Apple 公证。若 macOS 阻止打开，请在确认
   文件来自官方 GitHub 后，到“系统设置 → 隐私与安全性”选择“仍要打开”，
   并亲自完成系统确认。不同 macOS 版本的提示可能不同。
4. 首次启用系统代理或 TUN 时，按提示授权安装 Sivio 网络辅助服务。
5. 若代理端口已被占用，请在“网络设置 → 端口设置”选择一个空闲端口。

Quit the old Sivio before replacing it. Drag Sivio.app to Applications, wait for
the copy, eject this image, then launch Sivio from Applications. This internally
signed build is not Apple-notarized: macOS may require your explicit approval
in System Settings > Privacy & Security > Open Anyway. Authorize the network
helper when prompted. Change the proxy port if another app already uses it.

Official downloads: https://github.com/runway-studio/sivio/releases
Do not run the app from this read-only image or replace a running copy.
'''


def tree_digest(root):
    result = {}
    for path in sorted(Path(root).rglob('*')):
        if path.is_symlink():
            raise ValueError('Unexpected symlink inside application')
        if path.is_file():
            result[str(path.relative_to(root))] = (
                hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mode & 0o111)
    return result


def verify_dmg(image, version, expected_app=None):
    subprocess.run(['hdiutil', 'verify', str(image)], check=True, capture_output=True)
    with tempfile.TemporaryDirectory(prefix='sivio-dmg-mount-') as directory:
        mount = Path(directory) / 'volume'
        attached = False
        try:
            subprocess.run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen',
                            '-mountpoint', str(mount), str(image)], check=True, capture_output=True)
            attached = True
            link = mount / 'Applications'
            if not link.is_symlink() or os.readlink(link) != '/Applications':
                raise ValueError('DMG must contain the Applications drag destination')
            if (mount / 'INSTALL.txt').read_text() != INSTALL:
                raise ValueError('DMG installation instructions missing or altered')
            app = mount / 'Sivio.app'
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            if info.get('CFBundleIdentifier') != 'local.siassist.desktop' or info.get('CFBundleShortVersionString') != version:
                raise ValueError('DMG app product/version mismatch')
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
            actual = tree_digest(app)
            if expected_app and actual != tree_digest(expected_app):
                raise ValueError('DMG altered the final signed application')
            from privacy import Scanner
            scanner = Scanner()
            for path in mount.rglob('*'):
                if path == link:
                    continue
                if path.is_symlink():
                    raise ValueError('Unexpected DMG symlink')
                if path.is_file():
                    scanner.content(str(path.relative_to(mount)), path.read_bytes())
            scanner.require_clean()
            return {'verified': True, 'applicationFiles': len(actual), 'applicationsLink': '/Applications',
                    'signatureVerified': True, 'privacyScanned': True, 'notarized': False}
        finally:
            if attached:
                subprocess.run(['hdiutil', 'detach', str(mount)], check=True, capture_output=True)


def build_dmg(app, destination, version):
    app, destination = Path(app), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.sivio-dmg-', dir=destination.parent) as directory:
        root = Path(directory)
        content = root / 'content'
        content.mkdir()
        subprocess.run(['ditto', str(app), str(content / 'Sivio.app')], check=True)
        (content / 'Applications').symlink_to('/Applications')
        (content / 'INSTALL.txt').write_text(INSTALL)
        staged = root / 'Sivio.dmg'
        subprocess.run(['hdiutil', 'create', '-volname', f'Sivio {version}', '-srcfolder',
                        str(content), '-fs', 'HFS+', '-format', 'UDZO', str(staged)], check=True)
        result = verify_dmg(staged, version, app)
        staged.replace(destination)
    return result
