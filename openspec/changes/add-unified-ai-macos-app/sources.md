# 证据与上游边界

核对日期：2026-10-15。静态源码阅读，无运行或构建证据。文档中的“建议/设计”是本项目决策，“已核对”仅限读取到的内容。

| 来源代号 | 固定来源 | 本轮核对内容 |
| --- | --- | --- |
| CC | [CC Switch 固定源码](https://github.com/farion1231/cc-switch/tree/51ac86f1c59abfefabadebd05ec5a5415b8ad72c) | README、package、commands、provider service、database、mode、原子写入、Tauri 配置 |
| CC-SET | [设置手册](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/docs/user-manual/zh/1-getting-started/1.5-settings.md) | 终端、目录、客户端增强、WebDAV/S3、备份、授权中心 |
| CC-WS | [工作区手册](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/docs/user-manual/zh/3-extensions/3.5-workspace.md) | OpenClaw 工作区和每日记忆 |
| CC-TEST | [连通检测手册](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/docs/user-manual/zh/4-proxy/4.5-model-test.md) | HTTP 可达与鉴权成功不是一回事；探测不影响熔断 |
| CV | [Clash Verge Rev 固定源码](https://github.com/clash-verge-rev/clash-verge-rev/tree/4337bd85758d54d7b9044b2da3c9ac1176eae1f3) | README、package、Cargo、lib、core、config/runtime、enhance |
| CV-UI | [网络命令封装](https://github.com/clash-verge-rev/clash-verge-rev/blob/4337bd85758d54d7b9044b2da3c9ac1176eae1f3/src/services/cmds.ts) | 订阅、内核、DNS、备份、服务、端口、解锁检测等用户操作入口 |
| CV-SVC | [macOS 服务管理](https://github.com/clash-verge-rev/clash-verge-rev/blob/4337bd85758d54d7b9044b2da3c9ac1176eae1f3/src-tauri/src/core/service.rs) | 独立 helper、服务协议能力探测、owner session、服务状态；不是可直接嵌入的公共 SDK |
| SIGN | [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/) | ad-hoc 与 Developer ID/公证区分；本轮未检查用户证书 |
| LIC | [CC MIT](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/LICENSE)、[CV GPL](https://github.com/clash-verge-rev/clash-verge-rev/blob/4337bd85758d54d7b9044b2da3c9ac1176eae1f3/LICENSE)、[Mihomo LICENSE](https://github.com/MetaCubeX/mihomo/blob/Meta/LICENSE) | 代码复用须保留许可和来源；不以进程隔离推定规避许可义务 |

## 依赖锁定的交付要求
Mihomo 稳定/Alpha、服务 helper、service IPC、Tauri 插件及 workspace crates 的精确 commit/版本、下载 URL、SHA256、许可证和目标架构由 T01 生成 upstream-manifest。不能把 main、latest 或 Alpha 频道字符串当作可复现版本。M0 在这些记录完整前不得通过。

## 范围完整性方法
coverage.md 是本轮归纳的用户能力清单。T01 必须遍历固定基线的导航、commands、设置表和手册，产出子功能台账；每个 macOS 用户操作映射到已有功能 ID。发现缺项就补充同范围任务与情景，不能只以页面已存在宣称对等；若要求新增领域或改变权限/发布路线，提交窄范围设计修订。

## 明确排除
Windows UWP/注册表/WSL、Linux 专用窗口和发行包、广告赞助内容、原品牌及原更新服务器不属于产品对等目标；不把它们登记为延期功能。外部 AI 服务自身功能不属于本 App 的实现范围。

## 第二轮补充核对
F15补充来源为同一CC固定提交的 [omo.rs](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/omo.rs)、[openclaw.rs](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/openclaw.rs)、[hermes.rs](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/hermes.rs)、[env.rs](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/env.rs) 和 [plugin.rs](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/plugin.rs) 的公开命令清单。命令存在仅支持功能范围判断，不代表功能已在本项目实现。
