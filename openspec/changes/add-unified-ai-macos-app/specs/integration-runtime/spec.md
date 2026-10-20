## ADDED Requirements

### Requirement: F32 AI与网络出口协作
系统 SHALL 提供 AI与网络出口协作，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F32-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** direct/managed-network/custom-proxy 明确可选；managed-network 经指定内核出口；AI与网络状态分别呈现

#### Scenario: F32-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 网络服务不可用时 managed-network 请求失败而不直接出网；本地回环和控制流量不会形成递归

### Requirement: F33 外部配置并发与事务恢复
系统 SHALL 提供 外部配置并发与事务恢复，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F33-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 基线hash校验、staging、journal、原子发布与运行验证；并发变更按资源串行，活动状态仅在提交后更新

#### Scenario: F33-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 任一文件失败或进程中断后可确定恢复；外部修改不得被回滚误覆盖

### Requirement: F34 退出崩溃与睡眠恢复
系统 SHALL 提供 退出崩溃与睡眠恢复，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F34-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 关闭窗口服务持续，明确退出按顺序恢复CLI和系统网络；唤醒重新核对实际状态，事件按generation去重

#### Scenario: F34-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 强杀后 helper lease 恢复网络；CLI待下次启动恢复且可离线手动修复；不无限重启或静默直连

### Requirement: F35 不可信输入与系统边界
系统 SHALL 提供 不可信输入与系统边界，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F35-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 链接导入有预览，脚本限制权限和资源，ZIP路径/Markdown/CSS安全处理；IPC有参数校验和最小能力权限

#### Scenario: F35-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 恶意脚本/链接不能执行系统命令或访问 root helper；取消不遗留后台写入

### Requirement: F36 安装升级卸载及验收平台
系统 SHALL 提供 安装升级卸载及验收平台，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F36-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** macOS12+两架构完成安装启动更新回退卸载；内核/helper独立身份；卸载先恢复网络并允许保留用户数据

#### Scenario: F36-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 错误签名包拒绝；权限撤销/服务遗留有修复流程；不得删除原版 App 或其服务和数据

#### Scenario: F36-helper-crash 主进程与helper先后崩溃
- **WHEN** 应用停止续约且helper被杀后由launchd重启
- **THEN** 系统 SHALL 先读取持久网络快照，在lease过期后恢复仍由本App拥有的设置，再允许新会话；CLI仍由下次启动或离线步骤恢复

#### Scenario: F36-root-path 运行bundle越界
- **WHEN** 运行配置引用受控目录外文件、越界软链接或未在校验清单内的可执行程序
- **THEN** helper SHALL 拒绝请求，不能以root读取该文件或启动该程序
