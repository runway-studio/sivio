## ADDED Requirements
### Requirement: Persistent routing group strategies
系统 SHALL 提供 Order、Rotate、Usage；缺失策略的旧组 MUST 按 Order 行为运行。Usage SHALL 明确表示本机调度次数，不表示供应商账单或剩余额度。
#### Scenario: Concurrent rotation and usage
- **WHEN** 多个请求并发选择同一路由组
- **THEN** 系统事务化预留首选，Rotate 循环首选，Usage 优先低计数成员；相同计数按配置顺序排序
#### Scenario: Restart and configuration changes
- **WHEN** App 重启、组重命名或策略修改
- **THEN** 本机游标与计数保留；成员模型或排序变化时重置；WebDAV 导入保留本机运行状态
### Requirement: Explainable group scheduling
系统 SHALL 在决策记录中保存策略、调度时计数快照和实际尝试链，且 MUST 不保存消息内容或凭据。
#### Scenario: Fallback keeps the group selected
- **WHEN** Rotate 或 Usage 的首选失败
- **THEN** 请求沿排序后的备用列表重试、计数并记录实际模型；客户端保存的组别名不变
#### Scenario: Old decision records
- **WHEN** 读取缺少策略或解释字段的历史记录
- **THEN** 记录仍可展示，原有 Order 语义不变
