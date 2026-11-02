# Change: 完善 AI 工作区就绪、控制与恢复体验

## Why
Sivio 已有十客户端配置、四客户端网关、五种路由策略、MCP/Skills、网络和备份。当前主要问题是首次接入分散、运行状态易被理解为端到端可用、复杂路由缺少明确能力/连续性约束，以及现有 Profile、用量和快照尚未组成完整的工作流程。

本提案将上一轮确认的五项优化与四项后续功能全部转为可分阶段实施的增量；不重新实现已有路由策略或备份系统。

## What Changes
| 来源 | 交付内容 | Requirement | 阶段 |
| --- | --- | --- | --- |
| O1 首次成功调用 | 可恢复接入向导、空状态直达、配置/验证/客户端读取分离 | R03–R04 | A |
| O2 状态与诊断 | 统一就绪快照、用户发起的端到端验证、失败定位 | R01–R02 | A |
| O3 菜单减负 | 一致的常用客户端展示、能力标签、应用内命令面板 | R05–R06 | A |
| O4 可靠路由 | 能力过滤、同供应商多模型、可用身份下的会话固定与游标保护 | R07–R09 | B |
| O5 稳定版本收口 | 每阶段当前构建回归、最终核心旅程/设备矩阵 | R21–R22 | A–D |
| F1 项目环境方案 | 扩展现有 Profile，预览、可恢复应用、请求级出站 | R10–R12 | C |
| F2 预算控制 | 日/月预算、80%/100%提示、派发准入、方案归因 | R13–R15 | B/C |
| F3 运行报告 | 请求/尝试分开统计，可靠性/速度/已知费用和关联线索 | R16–R17 | D |
| F4 配置历史/选择恢复 | 可解释对象差异、引用检查、单项/分类恢复 | R18–R20 | C |
| 共通 | 向后兼容迁移、本机运行数据与同步配置隔离 | R23 | 各阶段 |

所有阶段属于本提案的验收范围；阶段完成可以单独交付，但不得将整个 change 标为完成。任务保留未勾选，待实施和证据齐备后更新。

## Impact
- specs：workspace-readiness、ai-tools、desktop-shell、model-routing、project-environments、budget-controls、operational-reporting、data-lifecycle、integration-runtime。
- 代码影响：Overview/NetworkHome/FirstRunNoticeDialog/ModelPicker/Sidebar；proxy handler_context/forwarder/session/routing_groups；profile/usage_stats/sync_protocol/restore_journal；SQLite schema 及同步排除规则。详细复用点见 [design.md](design.md)。
- 不引入新服务、数据库、云控制面或第三方依赖；不改 helper 权限协议，不自动安装/升级服务。
- 配置/IPC 采用增量可选字段；新增同供应商多模型与环境字段需升级 schema，旧二进制必须拒绝新 schema，不能静默丢字段。

## 范围与能力边界
- 全部十客户端可参与检测安装、配置引导、能力说明和快捷导航；主动模型验证、路由/预算控制仅覆盖四种已支持网关的客户端与其受支持凭据/协议。直连验证用同一适配器发起独立测试，不能证明客户端已重载配置。
- 聚合仍仅 Claude/Codex；本次不扩展聚合或新增客户端。路由组功能仅在原路由模式生效。
- 环境方案在现有 Claude Code、Claude Desktop、Codex scope 上扩展；新模型组/出站/预算字段仅在 Claude Code、Codex 生效，Claude Desktop 保留旧 Profile 行为并展示不支持字段。
- 环境作用于该客户端之后的请求，影响该客户端全部新请求；方案 ID 归因不等于已识别真实仓库。已有在途请求使用原快照。
- 首版预算阻止已达阈值后的新派发，不中断在途流、不保证并发超支为零；没有可信价格/usage 时显示未知并按明确策略处理。
- 报告只基于可观测流量；不将直连、未观察或未知费用当作零。
- 选择恢复限供应商、网络订阅/本地配置、MCP、提示词和 Skills；对现存对象只做显式添加/替换，不推断删除，不自动恢复活动选择、登录态或启动网络。

## 非目标与取舍
不做意图分类模型、自动质量评分、跨供应商私有会话迁移、自动仓库监听、团队权限/账单系统、插件框架、分布式事务、配置事件溯源平台、全局快捷键注册改造。公开发布、公证和新平台支持另行批准。保留现有 SQLite/JSON 凭据策略及加密备份，不恢复后台 Keychain 读取。

## 依赖与顺序
A（状态/诊断/接入/导航）→ B（路由/供应商预算）→ C（共享恢复基础→环境/选择恢复/方案预算）→ D（运行报告与最终验收）。
每阶段先数据契约及故障路径，再 UI，再端到端验收。详细 DAG 与逐任务验收见 [tasks.md](tasks.md)，核心旅程见 [acceptance.md](acceptance.md)。

## 与现有变更的关系
当前 openspec/specs 为空；本次全部用 ADDED 表达新的增量要求，不伪造已归档基线，也不复制整份旧要求。
- 叠加 add-unified-model-picker-and-route-decisions、add-live-routing-visualization、add-smart-pace-routing、extend-routing-group-strategies：保留四客户端、五策略、元数据隐私和失败证据；R08 显式放宽旧“供应商唯一”为“候选唯一”，R09 增加可选会话固定，R07/预算过滤优先于排序。
- 叠加 improve-network-ready-experience：复用自动准备内核和按需授权；就绪判断不把停止系统代理认作显式出口不可用。
- 延续 update-local-credential-storage：本机文件权限、显式迁移、默认导出去秘密不变。
- add-unified-ai-macos-app 的完整对等验收仍独立保留。本次阶段 D 不代替原 F01–F36 全部验收。
实施前重读并发 change，分配下一空闲 schema 版本；归档时按上述语义合并，旧提案不由本轮修改。

## 已知假设与开放问题
[brief.md](brief.md) 记录默认选择。当前没有阻塞规划的待决问题。外部账号、Intel/macOS 12 硬件和公开发布资源是未来验收/发布依赖，不可由本次文档检查宣称已具备。

## 规划交付条件
三门审查无未关闭 P0/P1；需求—任务—场景覆盖与本地链接检查通过；OpenSpec strict 通过。审批范围仅为规划，不自动进入代码实现。审查记录在 reviews/。
