## ADDED Requirements
### Requirement: Quota aware group scheduling
系统 SHALL 支持 Smart 与 Pace，以绑定到成员的有效额度选择候选，保持保存的组别名。
#### Scenario: Smart priority
- **WHEN** 多个成员拥有有效且未耗尽的窗口
- **THEN** Smart 按最早重置时间排列，Pace 按周剩余百分比/剩余小时降序排列，同分按配置优先级
#### Scenario: Missing or exhausted quota
- **WHEN** 查询不支持、失败、过期、缺少周窗口或已耗尽
- **THEN** 未知数据按配置顺序兜底，耗尽成员最后；无可评分成员时记录降级原因
### Requirement: Bound fresh quota collection
系统 SHALL 限制额度查询等待时间、合并并发查询，并按供应商凭据或明确账号绑定隔离；MUST 不读取无归属的应用级额度参与路由。
#### Scenario: Configuration and restart
- **WHEN** 凭据或绑定修改、重启或快照跨过重置点
- **THEN** 旧快照不能继续评分，系统重新查询；不改写用户模型选择
### Requirement: Explainable quota routing
决策记录 SHALL 展示额度来源、采样时间、排序指标与降级原因，MUST 不保留凭据或原始响应正文。
#### Scenario: Completed request
- **WHEN** Smart/Pace 请求完成或发生备用切换
- **THEN** 可查看选路快照和实际尝试链；旧记录继续可读
