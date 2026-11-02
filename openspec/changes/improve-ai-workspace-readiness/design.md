# 设计：工作区就绪与可控操作

## 1. 基线与最小架构
沿用 Tauri 命令→Rust services→SQLite/受保护配置写入→已有网关/网络运行时。前端只调用现有或增量命令，不直接写文件、跑 shell 或持有新增凭据副本。

| 责任 | 复用源码（仓库根目录相对路径） | 增量 |
| --- | --- | --- |
| 状态/引导 | app/src/components/overview/Overview.tsx、components/network/NetworkHome.tsx、components/FirstRunNoticeDialog.tsx | 一个共享就绪 hook 与 Rust 聚合命令；向导复用表单 |
| 导航 | app/src/components/shell/Sidebar.tsx、config/appConfig.tsx、lib/navigation.ts | 共用展示列表；cmdk 命令目录 |
| 请求边界 | app/src-tauri/src/proxy/handler_context.rs、forwarder.rs、session.rs | 候选身份、能力/预算筛选、环境/出站快照 |
| 路由 | app/src-tauri/src/services/routing_groups.rs 及 scheduler.rs/quota.rs | 成员模型身份、可选固定策略；保留五策略 |
| 环境 | app/src-tauri/src/services/profile.rs、commands/profile.rs | v2 payload、预览和恢复协调；保留旧 none 语义 |
| 数据恢复 | app/src-tauri/src/services/sync_protocol.rs、restore_journal.rs | 选中对象合并暂存、派生文件检查和事务边界扩展 |
| 费用/报告 | app/src-tauri/src/services/usage_stats.rs、proxy/route_trace.rs、routing_live.rs | 复用计费来源，新增有界结果元数据/日聚合 |
| 出站 | app/src-tauri/src/network/outbound.rs | 全局默认保留；每请求策略参数，不改全局 EGRESS |

不建立通用工作流引擎。新增类型和服务限定在上述业务责任内；数据库版本在实施时取下一空闲版本，不提前占用固定数字。

## 2. 就绪与验证契约
建议命令：get_workspace_readiness(app)、start_client_diagnostic(app, expectedRevision, activeProbe)、cancel_client_diagnostic(runId)。命令名为本提案接口目标，不声称当前已有。

ReadinessSnapshot 包含 app、configurationRevision、networkGeneration、credentialEpoch（不可逆内部版本）、observedAt、checks[]。check 状态固定 unknown/pending/pass/fail/unsupported/stale，每项有 reasonCode 和受控 actionId。来源状态分别展示：已保存配置、客户端读取未知/已观察、网关监听、所选出口、最近模型验证。运行中只表示进程状态，不等同模型可用；系统代理不是 direct/custom/显式 managed 出站验证的必备条件。

单次诊断固定 provider/model/mode/outbound/config/network/credential 版本。默认仅本地读取；activeProbe 必须用户点击，预览目标、可能消耗额度、最大等待。总时限30秒、同时每客户端1次，第二次返回 busy；取消关闭请求并丢弃迟到结果，不能承诺退还上游已发生消费。网络I/O不持有数据库或模式切换锁。先检查版本，派发前再检查，结束后版本不同仅记 stale。

主动探测只对四网关客户端支持的适配器，走明确选择的单一候选，不自动故障切换，使用固定无用户内容的最小提示和适配器允许的最小输出上限。通过合成会话标识和 purpose=diagnostic 进入同一出站/预算/费用边界，但不推进生产组调度/粘性状态，不触发自动切换配置。收到有效模型文本/协议成功终态才 pass；HTTP401/403为鉴权失败、429为受限、5xx为上游失败、HTTP响应可达不等于模型通过。不支持探测的客户端可完成“配置完成/验证不支持”流程，不显示全绿。

验证结果仅保留最后一次每客户端结果/时间/指纹，不存请求或输出；10分钟后标 stale，任何相关修订变更立即失效，应用重启后状态需重取。就绪被动查询复用现有事件和前台5秒轮询，不后台主动打模型。生成的客户端配置摘要相等只证明投影一致，不能推断外部进程已重读。

## 3. 用户流程与导航
向导步骤：选择客户端→检查安装/已有配置→复用添加或导入→复用模型选择→可跳过的主动验证→打开客户端/说明新会话要求。保存步骤ID和已选择对象ID，不存密钥；重入时按实际配置重算，不按旧步骤直接判完成。用户跳过不会反复弹窗，可从概览继续；不改变已配置老用户的首次确认或已有可见偏好。

新安装默认显示用户选择/已安装客户端，均未安装时展示选择入口；老用户保留隐藏与排序。概览和Sidebar消费同一个列表；能力标签源于 appConfig 的已验证矩阵，不承诺十客户端功能一致。保持导航ID、位置记忆、设置返回、未保存草稿保护。

命令面板使用已有 cmdk，应用内 Cmd+K，不抢占系统快捷键。索引仅客户端、模型/供应商、网络节点、最近会话标题和固定操作名称；不索引提示词正文、密钥、会话内容。导航直接执行，写操作进入原预览/确认/互斥入口，禁用时显示原因。支持中文/英文、键盘上下/Enter/Escape、焦点恢复、输入法组合键不触发快捷操作。列表上限按分类分页，不重建全库全文索引。

## 4. 路由候选、能力与连续性
### 4.1 候选身份
候选唯一键为 app + providerId + 精确规范化模型ID（只 trim，不擅自小写模型）。成员可同供应商不同模型；完全重复拒绝。总上限仍为10。执行上下文带 CandidateRef(providerId, model)，forwarder不得再按providerId找第一个模型。Usage计数/Rotate游标/排名/trace按候选身份；共享凭据、套餐缓存、供应商级熔断仍按原provider/认证身份，不把同账号余额重复算成多份。旧组自动兼容，成员变化沿用现有指纹重置策略。

### 4.2 能力契约与排序
后端必须拥有能力事实，不能仅信任前端models.dev展示。增量ProviderModelCapabilities记录 model/protocol、inputImage、tools、structuredOutput、contextLimit、source、updatedAt；字段三态 supported/unsupported/unknown。来源为已有固定预设/用户显式配置/既有拉取后验证的目录，不新增后台网络探测；模型/端点/认证配置改变后事实失效。用户声明标清来源，不显示为实测。

先解析请求显式能力（图片、tools、response_format/json_schema）；明确unsupported排除。新建组默认 strict（请求需要但unknown也排除），旧组迁移为 compatible（unknown允许并记未验证），UI可切换；路由编辑器对unknown能力提供模型元数据编辑入口及compatible含义说明，不能只在第一次请求失败后才暴露。已知精确token计数超过上下文必拒绝；无法可靠计数时显示未知，不把字符估算当精确拒绝依据，手动预设最小上下文要求仍可过滤已知过小成员。不读取/持久化prompt用于质量判断。

派发顺序：快照版本→连续性约束→能力过滤→预算过滤→原五策略排序/预留→每次实际尝试前重检预算与凭据→发送。过滤后的候选集合与原组成员分离，调度事务仍校验原组完整修订；只有实际保留的首选推进调度，不因无候选改变计数。已有响应开始后不拼接另一成员的流。

### 4.3 会话固定
组有两个明确字段：continuity=request/session 与 cursorProtection:boolean。旧组缺字段迁移为request/false；新建组默认request/true；选择session强制cursorProtection=true且禁用关闭；从session改回request保留true，只有用户在request模式明确关闭才为false。UI关闭提示“游标归属不受保护”；既有request/false保留旧转发行为但不宣称安全续接。修改任一字段后清理该组绑定，旧游标在再次开启时需重新建立归属。

仅 SessionIdResult.client_provided=true 且非Generated的既有提取来源可建立绑定；不能拿逐请求UUID或previous_response_id当稳定会话ID。无可信ID时显示session_identity_unavailable，并按request排序（仍遵守cursorProtection）；不宣称已固定。

绑定查找键为进程随机盐HMAC(app, groupId, clientSessionId)，值为CandidateRef、原组修订及认证版本；认证版本不放查找键，查到旧绑定后比较并拒绝变化，不能变键后当新会话。最多4096个、闲置2小时失效、只在内存。首次并发同会话用键级短锁建立一个预选，锁不跨网络I/O；若候选尚未返回仍保持预选。候选移除/认证变化/预算耗尽/能力不兼容均返回 continuity_unavailable，session模式不静默改投；用户新建会话后才重新选。

cursorProtection=true的组请求包含上游previous_response_id时，额外查询响应归属映射：键HMAC(app, groupId, responseId)，值为CandidateRef和认证版本；同样最多4096个、闲置2小时。只有已观察响应ID且provider/model/credential版本匹配才准入，request模式也不能跨归属故障切换。JSON/SSE观察器在首次解析到受支持的合法响应ID时立即记录来源（不等整流结束），同组同ID若出现不同来源则标冲突并拒绝后续续接；解析失败不造记录，不改变字节；未知协议/重启/淘汰导致归属未知时明确拒绝续接，提示新会话/完整上下文重发，不自动删除游标、重放历史或声称跨供应商迁移。适用范围只限路由组，既有非组直连/桥接行为不重写。

## 5. 预算与统计
### 5.1 明确首版语义
沿用provider limitDailyUsd/limitMonthlyUsd字段，新增mode=observe/block_new，默认observe；新增环境预算为可选方案限额。USD按十进制定点累计（微美元，溢出报错；展示四舍五入），拒绝负数/非有限/非法值。周期采用首次配置保存的固定UTC offset（分钟），默认当前系统偏移，UI明确“不自动跟随夏令时”。不使用SQLite运行时localtime；系统时区/DST变化不改现有周期。偏移修改按日/月各自下一个旧偏移边界生效，不重复开窗。

| 限额 | observe | block_new |
| --- | --- | --- |
| 空（未设置） | 不执行此scope预算限制 | 不执行此scope预算限制 |
| 0 | 立即显示已达限额，仅提示 | 拒绝此scope所有新尝试（含标称免费） |
| 正数且未达到 | 提示可能的未知费用，继续 | 仅已完成unknown/读取错误阻止；pending允许在途并发 |
| 正数且已达到 | 提示，继续 | 拒绝新尝试 |

日/月任一有效限制阻止即阻止；不存在适用限额时unknown不会凭空新增限制。observe允许预算读取错误时警告继续的前提是pending仍可持久提交；账本写入不可用返回ledger_unavailable并在两模式都禁止派发，不以observe绕过发送前记录。每attempt按准入时UTC时间及各scope固定offset确定周期，跨午夜完成仍结算到原周期，policy/offset变更不移动在途归属。

以本机网关实际尝试的已观测费用判断。只在本机可获得usage和明确价格时记known；无价格、失败/取消后缺usage记unknown而非0。未知费用数量随周期展示。block_new下有未结算历史unknown或数据读取错误则拒绝新派发并解释；observe下警告继续。每次attempt生成唯一ID，先在同一短事务完成适用准入检查和pending行持久提交，再允许发送任何上游字节；commit失败不得派发。单行携带provider与冻结environment归因，不创建两份独立账本；结算与两个scope聚合在同事务完成。当前在途是pending，允许并发，结束转known/unknown；确认尚未发送即取消可终结为known=0，无法证明未发送按unknown；启动将遗留pending转unknown。迟到可信usage可将unknown幂等转known并校正同一行，不另加一次消费。不承诺精确账单硬上限、并发超支零、外部用量全覆盖。

### 5.2 首次账本启用与核对
首次ledgerEpoch/cutoverTime在启动迁移且自动启动网关前建立；若旧进程仍服务先正常退出，不在运行中追认跨界请求。预算配置首次开启使用已建立账本，不重新建立epoch；不能把启用前在途最终日志跨截断重复计入。每日opening条目从现有proxy_request_logs和usage_daily_rollups的本机proxy来源生成，按原归档分区/来源键去重；日明细与同日rollup无法证明不重叠时标coverage_unknown，不相加猜测。金额解析原十进制文本，不沿用f64错误归零；当月为这些每日opening总和。保存来源摘要与cutover，重复迁移不重复导入。新attempt仅属于cutover之后的ledgerEpoch，旧异步写入由cutover拒绝合并为新attempt，迟到修正使用单独幂等adjustment。

旧记录无价格/usage、数据被清理或无法证明本周期完整时标coverage_unknown；可信已知金额仍保留，不能清零。首次开启block_new前展示本周期opening与覆盖缺口；未核对缺口按unknown阻止。方案旧消费无法证明归属，不分摊到新方案；新方案从启用点计费并明确本周期不完整。

未知费用提供两个现成控制：查看原因后显式改为observe，或等待对应周期结转。另提供本机“核对费用”入口，输入本周期保守估算/账单依据说明，追加adjustment并保留原unknown记录，标manual_estimate/resolved_for_admission；只解除该缺口的准入阻止，不称已知实账、不删除历史。调整使总额低于已知已计费用时拒绝；后续可信usage到达替换该项估算并保留调整轨迹。无需接入外部账单平台。

### 5.3 派发和通知
入口检查环境预算，每个候选派发前检查provider预算与环境预算，包括重试/故障切换和诊断。预算过滤不能被Smart/Pace耗尽兜底绕过；无候选时budget_exceeded，保留具体限制原因。已经发送的流不终止；费用按实际尝试记账（重试也可能计费），request_id+attempt_id去重，不拿最终成功一次代表全部消费。旧check_provider_limits遇SQL错误默认为0的路径不能用于准入，新增Result显式错误路径。

80%/100%各周期各对象通知一次，重启不重复；设置降低到已消费以下立即生效。首版仅“提示/阻止新派发”两种动作；路由已有其他未超限候选可继续，未配置预算内候选时不擅自新建经济组。

环境归因在请求准入冻结active profileId/revision，切换不改在途归属。无明确客户端/方案则unassigned，仅provider预算生效；UI称“当前方案流量”，不声称识别真实仓库。价格修正可以重算展示，但控制账本保留当次价格版本，历史调整需显式记录，不能静默降低已使用预算。方案限额本地设备生效，不能当跨设备账户限额。

## 6. 环境方案与配置恢复
### 6.1 v2 Profile
扩展现有payload（向后兼容none=不更改、空集合=清空），添加 modelSelection、outboundPolicy、budgetPolicy；保存对象ID和修订引用，不复制credentials、helper proof、PID或socket。明确mode，不能静默把direct改为routing。预览列出将影响的客户端、资源、当前/目标差异、缺失引用、外部修改、需要停止自有服务的范围。预览绑定整个受影响对象/派生文件摘要；任何变化要求刷新。

scope限制见proposal：新字段仅Claude/Codex。同客户端只能有一个活动方案，应用会影响该客户端全部后续请求；不改变其他scope。暂不自动绑定目录。请求保留immutable EnvironmentSnapshot，出站从该快照取得direct/managed/custom；custom只引用本机配置对象，不在trace/同步中复制秘密。未设置则继承全局默认；managed不可用明确失败，不退回直连。不改变系统代理、TUN、订阅或节点选择。

### 6.2 共享提交与恢复边界
选择恢复复用 sync_protocol::apply_staged_configuration(expected_before) 和 restore_journal：在私有暂存库/Skills树合并选中对象，再校验引用、schema、秘密占位与目标基线；不是新建事件存储平台。环境应用不能直接调用旧best-effort apply然后宣称成功：先生成操作计划，建立恢复点，受控应用；active profile仅全部受管配置写入并校验后提交。

复用现有sync_mutex作为唯一operation gate，不再新建并列互斥；扩展全部配置发布入口（环境/选择恢复/全量恢复/导入/同步应用、普通provider/model/group/Profile/MCP/Skills/prompt/network配置编辑）遵守同序。完整锁序：operation gate(sync_mutex)→按app固定排序的mode lock→Skills写锁（涉及树/引用时）→短DB事务；不需要的锁跳过。调用方最外层持锁，内部*_under_guard函数不得再次获取同一锁。同步网络下载/校验和上传材料准备在本地提交屏障外进行，进入提交后重核本地及远端父修订；任何持mode/Skills的旧入口不得倒过来等待gate。自动同步回调只在释放gate后排队，不在gate内同步等待自身。网络I/O不持mode/Skills/DB锁；helper lease与只读状态不使用gate。

不承诺DB、客户端文件与运行进程瞬时原子。预览确定以下三类，不能实现时临时决定：
- hot_policy：仅活动方案ID/outboundPolicy/budgetPolicy变化，且规范化provider/model/mode/MCP/Skills/prompt及派生文件摘要均相等。gate内单DB事务发布指针+策略revision；无外部写入，不排空、不停listener/Mihomo。在途保留原快照，新准入读新快照。
- app_configuration：任何受管客户端配置/资源变化。只暂停受影响app准入，最多30秒排空该app；超时返回busy、解除屏障、原指针/文件不变。不得关闭四客户端共享listener或Mihomo，其他app继续服务。排空后journaled→applying→committed→done；失败rolled_back/recovery_required。共享资源变更若影响其他app必须在预览列入scope并逐app排空，用户未确认的scope不能连带修改。
- snapshot_restore：现有全量暂存发布（含首版选择恢复）仍使用已有全网关/自有网络停止边界，预览明确停机影响；最多30秒排空，超时不强杀。恢复完成只尝试恢复原有可用状态，区别于环境的按app隔离。
保存DB/Skills及受管派生文件前后摘要/私有备份；现有journal只覆盖DB/Skills，必须扩展受管文件before/after manifest与恢复，启动先核对再投影。

崩溃恢复先于客户端配置投影/自动启动；仅当当前值匹配本操作已写入值时补偿，外部改写则保留现场、进入recovery_required并禁用受影响自动启动。回滚失败不能报成功，也不能自动覆盖外部配置。恢复原先运行状态失败时配置可保持committed但结果是“配置已保存/服务未恢复”，保留修复入口。显式完整恢复仍沿用现有全服务停止边界。

### 6.3 历史、差异和选择恢复
新增有界本机config change索引：operationId/time/source/objectIds/revisions/outcome/backupRef；内容来自已有私有备份，不复制一套全文事件库。默认最近50次/30天（先到限制清理），pending/recovery_required及仍被恢复引用的备份禁止清理；新增配置历史备份与日志不入云同步。

可选择 provider/networkProfile/MCP/prompt/skill 对象。选中对象依赖（如Skill文件、MCP凭据标记）随预览显式列出；选中provider ID被现有组引用时校验目标模型兼容，无法确认则阻止提交并提示修复，不连带删除组。默认不恢复active选择/本机运行计数/预算消费/会话绑定。依赖闭包同时检查当前provider选择、当前Profile、活动路由组/其成员、活动网络订阅及启用MCP/Skills。缺秘密/缺引用对象若正被活动依赖使用，同ID替换在预览阻止；提示先补凭据或用户另行停用/切换再预览，不隐式清活动指针、不修改未选依赖。闲置对象可保留待补占位而不激活。普通界面差异只显示秘密有变更，不能输出原值。只增加/替换用户选中对象，未选中对象序列化摘要不变。

## 7. 运行报告
复用现有usage日志与rollup，不从仅500条route_trace推算历史全量。追加有界运行事实表，以requestId/attemptId关联usage；终态去重，request成功率与attempt失败率分开。模型成功表示协议传输成功，不声称任务质量；failed/interrupted/unknown各列，活动请求不算终态。

保存UTC日聚合90天，明细7天或50,000条先到为准；不为报告延长prompt/响应留存。明细维度app/provider/model/group/environmentId/outbound kind/config revision；网络只用本机profile/node的不透明ID+generation，不存URL、账号、会话原ID。日聚合只用稳定维度app/provider/model/group/environmentId/outbound kind；高频config revision/node/generation关联仅在7天有界明细，超期显示不可关联，不建立高基数日桶。缺观察计数、缺usage/价格比例和采集起始日必须显示。诊断默认从生产可靠性视图排除但费用仍计入预算，可单独筛选。

指标：终态请求成功率=success/(success+failed)，取消和unknown单列不进分母；429/鉴权/TLS按attempt统计；TTFT仅使用确实观察首个内容帧的样本，展示样本量、p50/p95；无法解析则unknown。固定毫秒桶上界为50/100/250/500/1000/2000/5000/10000/30000/60000/+∞，nearest-rank取ceil(q*N)所在桶上界，溢出显示>60000ms，标近似；总请求延迟不得叫TTFT。费用显示known总和+unknown数量。配置变更关联按request快照revision，无证据只显示时间邻近，不宣称因果。不自动改模型/节点，不生成未经验证的质量排名。

## 8. 迁移、回滚和验收
settings/Profile采用可选字段默认值；SQLite新增表/列由统一迁移管理，一次迁移事务，前置私有备份，失败保留原库。并发change合并时取下一空闲版本。旧组request/compatible保持行为，新组默认strict；预算默认observe；游标保护严格遵守§4.3的旧request/false、新request/true、session/true矩阵，不因升级修改旧组转发行为，UI明确未保护限制。
预算账本、历史、报告、诊断和会话映射是设备运行数据：普通配置导出/WebDAV/S3排除，完整本机备份可含持久表，恢复配置不能把当前消费回退。预算账本恢复策略见R23；内存映射始终不导出。
旧二进制schema检查拒绝更高版本，回退应用须恢复升级前备份并明确丢失新配置；禁止声称降级无损。

验收分单元、真实本机HTTP/流式、组件交互和原生手动四层；现有自动化成绩不当成本次成绩。性能门槛复用原[验收标准](../add-unified-ai-macos-app/acceptance.md)。阶段D针对最终hash重新采证，硬件/账号缺失明确未验证；只规划阶段不运行业务回归或真实探测。
