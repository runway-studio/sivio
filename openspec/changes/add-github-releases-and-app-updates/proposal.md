# Change: GitHub Releases 与 Sivio 应用内更新

## Why

Sivio 已有检查更新、下载校验、安装重启和离线打包基础，但默认更新源/公钥为空，更新归档未签名，仓库没有发布工作流。用户希望参考 Clash Verge Rev 的 Releases，实现版本发布与应用内升级。

## What Changes

- 建立版本 tag 驱动的 GitHub Actions 发布流程：检查版本 → 构建 → 签名 → 生成完整资产与更新清单 → Release 草稿 → 校验后发布。
- 用户已确认首批仅支持 macOS Apple Silicon；Intel 保留后续扩展点，不把现有交叉编译当真机验收。
- 每版提供安装 ZIP、应用更新 `.app.tar.gz`、对应 `.sig`、`latest.json`、SHA256、精确匹配源码包及中文发行说明。DMG 不作为首批必需资产。
- 正式构建内置 Sivio 官方更新源和公钥，普通用户无需手填。保留高级自定义通道及明确禁用能力，迁移时不覆盖已有自定义配置。
- 提供检查、更新说明、下载进度、验证、确认安装重启、失败重试；安装须绑定用户看见的版本，并保护未保存草稿和网络退出清理。
- 保持当前 bundle ID、数据路径、内置双内核和约 80 MB 离线 App 的设计。用户已确认首版沿用稳定内部签名，保留系统首次安装提示；Apple Developer ID/公证不属于首批上线要求。

## Impact

- Affected specs: 新增 `release-distribution`、`app-updates`；落实原 `add-unified-ai-macos-app` 的 F04 和安装更新要求，不将整个旧提案标完成。
- Affected code: `.github/workflows/`、`scripts/build-app.py` 与发行脚本、Tauri 配置/版本文件、`app_updates.rs`、更新命令、设置及 About/UpdateContext。
- 不改变仓库可见性；若仓库私有，直接 Releases 链接不可作为匿名更新源，需另行指定可公开读取的发行仓库/存储。不得把 GitHub token 打进 App。
- 首次接入：旧版 0.1.0 默认未配置源，需手动安装带官方源的首个版本；之后验证完整 N→N+1 更新。

## Approval and readiness

状态：**用户于 2026-11-02 回复“开始吧”，已批准实施**。

2026-11-02 用户已确认 Apple Silicon 和稳定内部签名两项选择。方案采用单 stable 自动更新通道，RC 仅提供手动下载，不进入 stable feed。两项选型与完整提案均已获用户确认。

真正上线前必须取得/确认：发行资产可匿名读取；持续使用的 Tauri 更新签名密钥与公钥；CI 可用的稳定 macOS 签名身份。没有这些输入仍可完成实现与隔离夹具验证，但不能声称线上升级可用。本次调研 GitHub 连接器返回 404，本机 gh 请求失败，仓库可见性尚未核实。

## References

- [Clash Verge Rev Releases](https://github.com/clash-verge-rev/clash-verge-rev/releases)
- [上游 release workflow](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/.github/workflows/release.yml)：tag、草稿、签名构建、完整构建后发布；读取 blob `335f990873f6a773aa72292d1f75cc95e31e4e51`，2026-11-02。
- [上游 updater 脚本](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/scripts/updater.mjs)：从归档和签名资产生成平台更新索引；读取 blob `bb6d1b3c974bec0a24f6efda9de91247f171f73d`，2026-11-02。
- [Tauri updater](https://v2.tauri.app/plugin/updater/) 与 [macOS signing](https://v2.tauri.app/distribute/sign/macos/)。
- [实施计划](../../../docs/superpowers/plans/2026-11-02-github-releases-and-app-updates.md)。
