# Change: 集成 AI 工具管理与网络代理的 macOS App

## 导航交互修订（2026-10-16）

按本轮要求，规划一级「概览 / 网络 / 模型」、保留原菜单样式的二级目录及右侧内容三栏布局。见 [可点击原型](design/navigation-v3/index.html) 与 [交互规则、实施拆分和设计审查](design/navigation-v3/interaction-design.md)。用户已于 2026-10-16 批准实施。本轮三栏改造已接入正式 App；实施与验收记录见 [交付说明](../../../docs/implementation/navigation-v3-delivery.md)。原完整功能范围与待验收项不变。

## Why
用户需要在同一个 macOS App 中管理 AI 工具、供应商、扩展及会话，同时管理网络订阅、节点、规则和系统代理，减少多应用切换和配置互相覆盖。现有仓库仅有研究文档，需要先确定可实施的集成边界。

## What Changes
- 一个 Tauri 主应用、一个统一侧栏/设置/托盘；在应用内完成两项目的用户操作，不依赖启动两个原版 GUI 才能工作。
- 以 CC Switch 的业务模块和 UI 体系为底座，移植 Clash Verge Rev 的网络领域能力；Mihomo 和特权 helper 继续独立运行。
- 覆盖 AI 供应商、客户端管理、MCP、Skills、提示词、项目、会话、用量、本地 AI 路由及聚合；覆盖订阅、节点、规则、连接、日志、系统代理、PAC、TUN、DNS、内核和服务管理。
- 合并重复的备份、同步、更新、诊断、主题和生命周期入口，并保留原有能力边界。功能清单见 [coverage.md](coverage.md)，规范见 specs/。
- 引入两个领域之间的显式出站策略、配置写入所有权、迁移和恢复协议。
- 只规划，不创建产品源码、安装依赖、运行上游构建、修改系统代理、安装 helper 或迁移用户数据。

## Execution Authorization

用户在设计稿和 Logo 确认后明确授权“执行这个提案，实现后，打包生成 app 文件”。此前“只规划”的描述记录原规划轮次；从本次起允许按任务依赖实施和构建。实际进度与阻塞见 [执行记录](../../../docs/implementation/m0-progress.md)，验收标准继续生效。

## Confirmed Scope
2026-10-15 用户明确确认：先内部使用，发布方式后定；完整覆盖两个项目的 macOS 用户功能，分阶段实施，不接受仅提供启动入口。实施可由用户批准后开始，本轮没有实施授权。

“完整”是固定基线中 macOS 可用功能与其限制的对等覆盖，不是复制品牌、赞助广告、所有视觉像素、Windows/Linux 功能，也不包含上游未来功能。基线中实验性功能保留实验标识；不把上游不支持的客户端组合承诺为支持。

## Baseline
- CC Switch：`51ac86f1c59abfefabadebd05ec5a5415b8ad72c`，package 4.0.12；查询时 latest release 为 v4.0.12。
- Clash Verge Rev：`4337bd85758d54d7b9044b2da3c9ac1176eae1f3`，package 2.5.8；查询时 latest release 为 v2.5.8。
- 使用上述 SHA 定义功能，release 名称仅作背景，不假设 tag 与 main SHA 相同。上游引入清单和来源见 [sources.md](sources.md)。

## Delivery Boundaries
| 阶段 | 可演示成果 | 完成条件 |
| --- | --- | --- |
| M0 可实施性验证 | 锁定上游依赖，验证一个宿主下 AI 与网络通路及 helper 身份隔离 | T01–T04 证据通过；失败只暂停依赖任务，不改称全量完成 |
| M1 可用骨架 | 统一桌面壳、存储/迁移、基础供应商和普通网络代理 | T05–T10 通过，可用于内部早期试用 |
| M2 核心融合 | AI 路由、系统代理/TUN、完整网络操作、扩展配置 | T11–T18 通过 |
| M3 功能补齐 | 全部客户端、账号/用量/会话/项目、同步及偏好 | T19–T25 通过，功能矩阵所有行有证据 |
| M4 内部交付 | 真机回归、恢复演练、安装更新卸载 | T26–T28 通过；只有此阶段可声明本提案集成完成 |

## Impact
新增 capability：desktop-shell、ai-tools、ai-routing、network-proxy、data-lifecycle、integration-runtime。影响未来的应用目录、用户所选 CLI 配置文件和系统网络状态；首次写入必须通过预览和备份。旧版两个 App 不被卸载或自动改写数据。

## Assumptions and Non-Goals
- 目标系统默认 macOS 12+、Apple Silicon 与 Intel；沿用两项目共同可支持的最低系统作为验收目标。实际内核/helper/SDK 最低版本在 T02/T03 检查，不能静默抬高。
- 内部直接分发 .app/.dmg，不走 Mac App Store。开发可 ad-hoc 签名；给其他机器的受控分发按签名、公证流程验收。
- 初期只使用本地单用户架构；不建设云控制台、账号计费、插件市场、通用工作流引擎或自己的 AI 聊天/Agent 执行平台。
- 不重写 Mihomo，不把网络代理误当成 AI 模型协议转换，不把两套 React 根和 Tauri 主进程直接拼接。
- 内部使用允许推进方案设计，不等同于闭源分发许可。外部分发需要另行确认许可义务、依赖来源、品牌及更新基础设施；本轮不替用户确定最终产品许可证。

## Acceptance and Review
每一功能行绑定任务和两个验收情景；[acceptance.md](acceptance.md) 定义通用交付标准。需求/架构/实施可行性审查及修订见 [reviews/quality-gates.md](reviews/quality-gates.md)。评分只表示规划质量，不代替运行验证。

## UI Design Assets
2026-10-15新增 [macOS交互设计稿](design/index.html) 与 [设计资产索引](design/design-map.md)，包含11个页面入口、核心操作模拟、深浅主题和10张预览图。它们属于提案设计资产，不是产品实现。部分高级功能仅有入口/说明，未改变完整范围和28项实施任务的未完成状态。
