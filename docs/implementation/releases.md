# Sivio 版本发布与应用内更新

首批支持 macOS Apple Silicon，使用稳定内部签名，未做 Apple 公证。安装 ZIP 用于首次安装，完整 `.app.tar.gz` 加 Tauri 签名用于后续升级。正式 feed 为 `https://github.com/runway-studio/sivio/releases/latest/download/latest.json`，仓库和资产需公开可读取；不能向 App 内嵌 GitHub token。

## 一次性准备

当前公钥已保存于 `app/src-tauri/release-config.json`。对应更新私钥、随机密码位于被 Git 忽略的 `build/cache/update-signing/`，目录 0700、私钥/密码文件 0600。保持安全备份，勿提交、打印或放入源码包。不要重新运行 key generation 覆盖这套身份；丢失私钥后旧公钥客户端不能自动信任新密钥。

macOS 内部身份来自已有 `build/cache/codesign/`。更新签名和 macOS 签名独立，前者保护下载来源，后者保持网络 helper 对 App 的身份认可。首批继续使用原稳定证书，不替换证书或 bundle ID。

先完成 `gh auth login`，并确认有仓库管理员权限，然后执行：

```sh
python3 scripts/release/configure-secrets.py
```

P12 导出要求交互授权时，可使用专用钥匙串路径：`python3 scripts/release/configure-secrets.py --keychain-snapshot`。它只复制项目创建的加密 `build/cache/codesign/signing.keychain-db`，使用同目录已有密码，不读取用户登录钥匙串，也不改变签名身份。当前部署采用此方式；已核验该钥匙串只有一条私钥和一条证书，且隔离副本完成了解锁、签名及证书指纹验证。

脚本通过标准输入设置 GitHub Secrets，不打印密钥，也不会创建 tag/Release。P12 方式结束时删除临时副本。需要以下配置（macOS 两种方式择一）：

| 类型 | 名称 | 用途 |
|---|---|---|
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 已有 Tauri 更新私钥内容 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 更新私钥密码 |
| Secret | `SIVIO_CERTIFICATE_P12` | 稳定内部 codesign 身份的 base64 P12 |
| Secret | `SIVIO_CERTIFICATE_PASSWORD` | P12 密码 |
| Secret | `SIVIO_SIGNING_KEYCHAIN` | 专用加密钥匙串的 base64 快照，优先于 P12 |
| Secret | `SIVIO_SIGNING_KEYCHAIN_PASSWORD` | 专用钥匙串的项目生成密码 |
| Variable | `SIVIO_CODESIGN_IDENTITY` | 稳定证书 SHA1 指纹 |

CI 将 P12 导入临时 keychain，或将专用钥匙串还原到私有临时目录并解锁，签名完成后删除；不生成新的 codesign 身份，不缓存私钥。Apple Developer ID/公证不属于此首批工作流。

## 准备一个版本

```sh
python3 scripts/release/version.py set 0.2.0
python3 scripts/release/version.py check --tag v0.2.0
python3 -m unittest discover -s scripts/release -p 'test_*.py'
pnpm --dir app typecheck
```

`set` 同步 package.json、tauri.conf.json、Cargo.toml 与 Cargo.lock 中的本包版本，保留依赖与 helper 协议版本。创建 `docs/releases/v0.2.0.md` 发行说明，记录功能、限制和迁移要求；提交代码后创建对应 tag。首发候选仍使用当前 0.1.0，已有内部 0.1.0 用户手动安装，不把同版本重新分发当自动升级。

```sh
git tag v0.2.0
git push origin v0.2.0
```

这些命令会触发真实发布，执行前核对版本/SHA/发行说明。tag 触发：构建全部成功后发布。`workflow_dispatch` 默认 `validate_only=true`：从所选分支的干净提交构建并上传验证资产，不创建 tag 或 Release；输入 tag 仅校验版本。关闭该选项并输入已有 tag 才准备草稿。发布后的同 tag 不可重建覆盖，修正应使用新版本。RC 使用 `v0.2.0-rc.1`，只作为 prerelease 手动下载，不成为 stable latest。

## 产物与验证

每版包含 `Sivio-<version>-aarch64.zip`、`.app.tar.gz`、`.app.tar.gz.sig`、精确源码包、`latest.json`、`SHA256SUMS`、`release-evidence.json` 和发行说明。

先完成所有资源修改并签 App，最后生成归档并签更新包。发行生成器使用与 App 相同的 Rust 验签函数，检查真实字节、产品/版本/架构、源码摘要和 tag；拒绝未提交源码及不完整资产。CI 从固定内核下载清单准备资源，不依赖开发机器缓存。publish job 重新验签和核对上传摘要后才公开版本；发布后不带身份认证回读全部资产与 latest。回读失败时恢复此前 latest（若存在），运行标失败；首次发行没有旧 latest 可恢复，须人工检查且不能宣称上线完成。

本地诊断构建可以调用 `scripts/build-app.py --release-distribution` 并显式提供签名环境；工作区不干净时报告记录 `sourceDirty=true`，这类验证包不能经过发行生成器发布。正常发行统一使用 `scripts/release/build.py --tag <tag>`，要求干净 tag checkout。

## App 使用与恢复

旧默认无更新源的 0.1.0 先从发行页手动安装新包。之后在“设置 → 关于”检查更新、阅读说明、下载验证，再确认安装重启。自动检查仅提示，不自动安装。高级设置可选择官方、自定义或禁用，已有自定义配置保留；关闭自动检查仍允许手动检查。

下载阶段保持网络运行。替换前会阻止新 IPC、等待并锁住现有网络与客户端配置写入，再清理自有网络；校验或清理失败不替换。安装使用同卷暂存，移动新包失败时恢复旧包，不调用底层插件的先删除再安装路径。成功后旧包保留于应用旁 `.sivio-update-*/previous.app`，确认新版本正常且旧进程退出后可手动清理。它仅含旧 App，不含用户数据库；不要自动降级迁移后的数据库。若应用目录不可写，移动到可写 Applications 位置或手动安装，不在更新流程索要管理员密码。

签名、架构或包身份错误会被拒绝。下载取消或换源会废弃旧候选。网络恢复失败时在网络页检查/修复，不能通过放宽 helper 证书校验来规避身份迁移。

## 当前交付边界

代码与本地测试不等于 GitHub CI/原生升级验收。实际进度见 `openspec/changes/add-github-releases-and-app-updates/acceptance.md`。发布前仍需验证干净 runner、匿名资源访问、隔离 N→N+1、同签名 helper 行为；未执行项目保持 NOT_VERIFIED。
