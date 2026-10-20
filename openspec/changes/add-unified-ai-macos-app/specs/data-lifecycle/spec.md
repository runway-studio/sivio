## ADDED Requirements

### Requirement: F28 两项目迁移与格式兼容
系统 SHALL 提供 两项目迁移与格式兼容，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F28-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 只读扫描、选择来源、预览冲突、备份、导入；兼容基线 SQL/配置归档；重复导入不产生重复实体

#### Scenario: F28-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 不支持的 schema 和损坏归档拒绝导入，旧 App 数据及原客户端文件保持原样

### Requirement: F29 本地备份恢复和清理
系统 SHALL 提供 本地备份恢复和清理，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F29-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 支持即时/定时备份、保留策略、列表重命名删除、导入导出、其他备份占用浏览，恢复前自动备份并校验 manifest

#### Scenario: F29-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 磁盘满/备份损坏时恢复不开始；备份清理不得删除当前 pending journal 所依赖文件

### Requirement: F30 WebDAV和S3同步
系统 SHALL 提供 WebDAV和S3同步，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F30-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 支持连接测试、手动上传下载、自动同步和远程快照预览；WebDAV/S3 二选一；同时备份 AI 和网络数据

#### Scenario: F30-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 远程版本冲突不静默覆盖；失败可重试；运行状态和 helper 凭据不上传，默认不包含用户秘密

### Requirement: F31 密钥与导出隐私
系统 SHALL 提供 密钥与导出隐私，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F31-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 按已批准 update-local-credential-storage 方案将新凭据保存在本机 SQLite/JSON；私有目录0700、凭据文件及完整本地备份0600，界面默认掩码；诊断脱敏，普通导出去秘密，含秘密可移植包认证加密

#### Scenario: F31-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 旧钥匙串引用未迁移时明确提示，不弹出系统授权或保存默认值；文件访问、迁移失败时保留原数据；日志不得出现完整 token、订阅URL中的秘密或会话正文

#### Scenario: 旧凭据迁移与正常本地访问
- **WHEN** 存在旧自有 Keychain 引用
- **THEN** 只在用户主动开始迁移后备份并读取旧条目，逐文档原子提交；拒绝/暂停保留进度，重启后仅继续剩余文档
- **AND** 新建和已迁移配置在启动、保存和切换时无需读取自有 Keychain，旧条目不自动删除；第三方官方登录授权独立保留
- **AND** 内部构建继续保留稳定签名身份，私钥不进入代码或分发包

#### Scenario: F31-secret-backup 含秘密的云备份
- **WHEN** 用户显式选择含秘密备份并设置口令
- **THEN** 系统 SHALL 在上传前认证加密，错误口令或篡改归档在写入活动目录前拒绝；默认导出不含秘密

#### Scenario: F31-untrusted-sql SQL导入边界
- **WHEN** 导入文件含ATTACH、extension或非批准schema的语句
- **THEN** 系统 SHALL 在隔离解析阶段拒绝，活动数据库和任意外部文件保持不变
