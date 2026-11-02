## ADDED Requirements

### Requirement: R07 能力约束先于路由策略
系统 SHALL 根据后端可验证或显式声明的三态能力筛选候选，再执行原五策略；新组默认strict，旧组compatible，支持切换。未知能力不得显示已验证；无法准确计数的上下文不得用字符估算宣称精确兼容。

#### Scenario: 不兼容候选
- **WHEN** 请求含图片/tools/结构化输出且某成员明确不支持
- **THEN** 排除该成员并记录原因；无候选明确失败，不发送或推进调度计数

#### Scenario: 未知能力
- **WHEN** strict或compatible组遇到所需能力unknown
- **THEN** strict排除，compatible可尝试但显示未验证；旧组升级保留compatible

#### Scenario: 上下文边界
- **WHEN** 可靠token计数或用户最小上下文约束超过已知成员容量
- **THEN** 过滤该成员；无可靠计数时标unknown，不伪造精确判断

### Requirement: R08 同供应商多模型的独立候选
系统 SHALL 以app/providerId/model作为候选身份，允许同供应商不同模型，仍最多10成员；调度/trace使用候选身份，凭据/配额/供应商熔断共享，不重复计算账户资源。

#### Scenario: 同账号两模型
- **WHEN** 组含相同providerId的两个不同model
- **THEN** 分别选中正确模型、计数和记录，不再按providerId误取首模型

#### Scenario: 完全重复与迁移
- **WHEN** 创建重复provider/model或读取旧组
- **THEN** 重复拒绝；旧组可读，成员修改按原指纹重置计数，五策略回归保持

### Requirement: R09 可解释的会话固定与游标归属
系统 SHALL 提供continuity=request/session及cursorProtection。旧组迁移request/false，新组默认request/true，session强制true；切回request保留true，仅显式关闭才false。稳定绑定键不含可变凭据版本，版本在值中校验；固定成员失效不得静默换供应商。cursorProtection=true时previous_response_id必须具有同app/组/候选/认证版本的已观察归属，否则拒绝续接，不迁移私有会话。

#### Scenario: 固定会话并发
- **WHEN** session模式同一可信会话同时产生请求
- **THEN** 短锁形成一致预选，后续使用同候选；不同客户端/组/会话互不串用，网络I/O不持绑定锁

#### Scenario: 缺身份或固定成员失效
- **WHEN** 缺可信会话ID，或已绑定成员被删/改凭据/受预算或能力限制
- **THEN** 前者降级request并解释；后者返回continuity_unavailable，提示新建会话

#### Scenario: 响应游标重启或换成员
- **WHEN** 受保护组的请求含归属未知或认证已变化的previous_response_id
- **THEN** 不把游标当session ID、不发给其他成员、不自动移除游标；重启/淘汰后明确要求新会话

#### Scenario: 绑定资源界限
- **WHEN** 内存绑定超过4096或闲置超过2小时
- **THEN** 会话与响应归属分别最多4096项、2小时闲置失效；HMAC隔离app/组，不持久化原ID；合法响应ID首次解析即记归属，同ID来源冲突拒绝续接；丢失按未知路径处理

#### Scenario: 新旧保护设置与认证轮换
- **WHEN** 旧组升级、新建组、切换request/session或轮换绑定供应商凭据
- **THEN** 默认值遵守request/false、request/true、session/true矩阵；false保留旧行为但显示未保护；true只接受正确归属；字段修改清绑定，认证变化查到旧绑定后拒绝，不换键重选
