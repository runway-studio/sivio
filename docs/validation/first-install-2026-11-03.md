# GitHub 首次安装验证：2026-11-03

## 实测结果

当前 `v0.1.1` 不能宣称在干净 Mac 上默认直接打开。安装包完整性与自带签名通过，Gatekeeper 默认执行策略拒绝，未附带公证票据。此结果不等于 App 在用户手动允许后仍无法运行。

- 环境：一次性 GitHub macOS 14.8.9 ARM64 runner。
- [验证运行](https://github.com/runway-studio/sivio/actions/runs/41620791092)，测试代码提交 `3a078beebd44c6962411c5501fb9bdd124167225`。
- 无 Sivio 数据目录、无已安装辅助服务、钥匙串查找列表中无 Sivio 签名证书；任务未注入任何签名凭据。
- 匿名下载官方 `Sivio-0.1.1-aarch64.zip`，SHA256 为 `e36d1b5c1d8048825521590ce13c654852bcc66cdfeee36ba599529bb370e33d`，与公开校验文件一致。
- 解压后 `codesign --verify --deep --strict` 返回 0；不需要预先导入开发机的公开证书即可通过完整性校验。
- 给测试 App 添加模拟浏览器下载的 quarantine 属性，保留该属性，未降低系统执行策略。
- `spctl --assess --type execute --verbose=4` 返回 3，结果为 `rejected`。
- `xcrun stapler validate` 返回 65，结果为无 stapled ticket。
- 原始报告保存在该运行的 `first-install-evidence` artifact。

## 已验证范围与剩余步骤

| 检查 | 结果 |
|---|---|
| 无预装服务、应用数据、Sivio 证书 | 通过 |
| 匿名下载与 SHA256 | 通过 |
| 包签名完整性 | 通过 |
| 默认 Gatekeeper 放行 | 失败 |
| 本地公证票据 | 缺失 |
| 浏览器真实下载及交互首次打开 | 未验证，当前使用 quarantine 模拟 |
| 用户手动允许后的启动 | 未验证 |
| 首次辅助服务授权及拒绝后重试 | 未验证 |
| 首次订阅、代理、TUN 和重启恢复 | 未验证 |

不得把未公证当作文件损坏，也不得把构建 runner 的验签或升级测试当作上述首次使用流程的成功证据。

## 与 Clash Verge Rev 对照

Clash Verge Rev 当前公开发布工作流将 `APPLE_CERTIFICATE`、`APPLE_SIGNING_IDENTITY`、`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 传入 Tauri 打包流程：[官方工作流](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/.github/workflows/release.yml)。本次对开发机已安装 Clash Verge 的只读核验显示 Developer ID Application 签名、stapled notarization ticket 和 `accepted / Notarized Developer ID`。本机对照仅描述这份已安装副本，不替代对上游所有历史版本的核验。

## 当前阻碍

项目所有者确认尚无 Apple Developer 账号及 Developer ID Application 证书。实现 macOS 默认策略下的正常首次打开，需要开发者持有适用身份并完成签名、公证；这无法通过更改 App 的业务代码或复用上游证书解决。

无账号的发行可以明确要求用户在确认官方来源后自行作出一次性允许决定，但这应作为单独的、尚待验收的安装路径。不能静默清除用户下载隔离属性、关闭 Gatekeeper、放宽 helper 身份验证，也不能宣称“下载后默认直接打开”。

Apple 参考：[Developer ID 分发](https://developer.apple.com/developer-id/)、[公证要求](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
