## ADDED Requirements

### Requirement: R10 扩展现有方案并预览作用范围
系统 SHALL 向后兼容扩展现有Profile，将模型选择/组、MCP/Skills/提示词、请求出站和预算按客户端scope组合；新增字段只在支持的scope生效，none=不更改。预览绑定引用修订并明确影响该客户端所有后续请求，不能宣称自动识别真实仓库。

#### Scenario: 旧方案与不支持字段
- **WHEN** 读取旧Profile或Claude Desktop方案
- **THEN** 保留原供应商/MCP/Skills/提示词及none/空集语义；不支持的新字段不得自动写入客户端

#### Scenario: 预览过期或缺引用
- **WHEN** 预览后对象变化、被删除或目标模式不兼容
- **THEN** 阻止应用并保留选择；列明差异和缺失依赖，要求刷新，不自动改变模式

### Requirement: R11 方案的可恢复应用
系统 SHALL 按预览差异区分仅策略hot_policy与文件/资源app_configuration：前者单DB事务提交指针/策略且不排空，后者按受影响app暂停准入并排空、通过持久恢复点应用。不得关闭共享listener或Mihomo；仅全部受管写入校验后提交活动指针，失败补偿或进入recovery_required。

#### Scenario: 中途失败
- **WHEN** 供应商已写而Skill/MCP写入失败
- **THEN** 恢复已改对象或明确recovery_required；不提交目标活动指针，保留原方案与故障原因

#### Scenario: 外部编辑与崩溃
- **WHEN** 操作中发生外部文件改写或任意持久边界强杀
- **THEN** 启动先恢复再自动投影；不覆盖非本操作产生的外部值，受影响自动启动暂停

#### Scenario: 存在在途流
- **WHEN** app_configuration变更且受影响app仍有活动流
- **THEN** 只暂停目标app准入，最多等30秒；未排空则busy、解除屏障且原指针/文件不变，其他app持续服务，不强杀外部客户端

### Requirement: R12 请求级环境归属与出站隔离
系统 SHALL 在请求准入固化方案ID/revision和出站策略；未设置继承全局默认，managed不可用明确失败。方案切换不得修改系统代理/TUN或其他客户端出口。

#### Scenario: 切换期间在途与新请求
- **WHEN** Claude方案A请求未结束，切到仅outboundPolicy/budgetPolicy/活动方案ID不同的B，Codex并行运行
- **THEN** hot_policy单事务发布：在途保留A，新Claude请求使用B；共享listener、Mihomo、Codex与系统代理不变；涉及文件变更改走R11排空路径

#### Scenario: 受管出口失败
- **WHEN** 方案指定managed但本应用网络不可用
- **THEN** 请求明确失败，不能回退direct；日志不保存custom代理凭据

#### Scenario: 归因能力不足
- **WHEN** 请求无法归属明确客户端方案
- **THEN** 标unassigned，不猜仓库/方案；provider统计仍有效
