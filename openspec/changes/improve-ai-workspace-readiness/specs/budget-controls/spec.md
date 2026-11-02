## ADDED Requirements

### Requirement: R13 明确范围的预算设置
系统 SHALL 提供provider及受支持方案的日/月USD预算与observe/block_new，默认observe；保存固定UTC offset、不跟随系统时区或夏令时，十进制定点计费；明确仅控制本机可观测网关新派发，不能保证实际账单硬上限。

#### Scenario: 非法值与零限额
- **WHEN** 用户输入负数/非法数或明确0
- **THEN** 非法保存拒绝；空限额不限制，0表示立即达到：observe仅提示、block_new拒绝所有新尝试（含标称免费）；正数达限同此模式规则

#### Scenario: 周期边界
- **WHEN** 跨日/月或修改系统时区/预算时区
- **THEN** 按保存的UTC offset只结转一次；系统时区/DST不改变周期，偏移修改在日/月各自下一旧边界生效；降低上限立即影响后续准入

### Requirement: R14 所有尝试的预算准入与未知费用
系统 SHALL 在请求和每次实际尝试前检查适用预算，覆盖重试/备用/诊断；known/pending/unknown分离，未知不记0；pending必须在任何上游字节发送前持久提交，单行同时关联provider/方案，两scope结算同事务。block_new遇已完成unknown或统计错误拒绝，observe预算读取失败可警告继续但仍须pending持久成功；账本写失败两模式都不派发；按attempt准入时周期结算，跨日完成不移动消费；在途不终止，可能并发超出阈值。

#### Scenario: 达到限额后故障切换
- **WHEN** 首成员受限而其他已配置候选预算可用
- **THEN** 只派发可用候选；全部受限则budget_exceeded；Smart/Pace不能绕过

#### Scenario: 费用未知或数据库错误
- **WHEN** 缺价格/usage、费用迟到或预算查询失败
- **THEN** 未知/错误显式展示；block_new拒绝后续派发，不沿用查询错误归零路径

#### Scenario: 流式与重复结算
- **WHEN** 多个请求已在途、发生取消/失败/重试或重复回调
- **THEN** 不中断在途；每attempt幂等结算，缺usage为unknown，启动遗留pending转unknown；可信迟到usage幂等更新原行；提示并发可能超支

#### Scenario: 派发持久边界
- **WHEN** 在pending提交前/后、上游发送后/结算前强杀进程或数据库提交失败
- **THEN** 未持久提交不得发送；已派发必有pending并在恢复后为unknown，不漏账；同一attempt的provider和方案结算不双计

#### Scenario: 未知费用的可操作处理
- **WHEN** block_new因历史unknown或coverage_unknown阻止请求
- **THEN** 显示周期/原因；可显式改observe或等周期结转，也可追加有依据的保守核对估算以解除该缺口；原unknown和调整轨迹保留，不能静默清零或少于已知消费

### Requirement: R15 预算提示与准确的方案归因
系统 SHALL 每对象每周期在80%/100%仅通知一次；按请求冻结方案归因显示known费用及unknown数量，诊断计入成本；不把直连/外部消费或当前Profile当真实仓库事实。

#### Scenario: 阈值重启去重
- **WHEN** 消费跨过80%/100%后应用重启或重复回调
- **THEN** 各阈值只通知一次，诊断费用保留

#### Scenario: 请求过程中切换方案
- **WHEN** 请求开始于A结束于B激活后
- **THEN** 费用归A；无法归因显示unassigned，不重新归B

#### Scenario: 价格修正
- **WHEN** 用户修改价格或补录缺失usage
- **THEN** 展示可重算并显示依据；控制账本保留价格版本和显式调整记录，不静默减少已用预算
