# Change: 参考 CC Switch 改用本地凭据存储

## Why

用户反馈打开 Sivio 需要连续输入登录钥匙串密码，希望参考 CC Switch 避免反复授权。当前实现为多个字段分别创建不可变 Keychain 条目，普通配置加载也需要打开这些条目；固定签名不能自动迁移旧条目的授权。

仓库内 CC Switch 基线在 `src-tauri/src/database/dao/providers.rs` 中直接序列化供应商配置到 SQLite。部分 Claude/Codex 官方登录流程仍读取系统钥匙串，因此不承诺所有第三方账号功能永不出现系统授权。

## What Changes

- Sivio 自有供应商、MCP、网络订阅和偏好凭据采用本地 SQLite/JSON 存储，不再逐字段创建 Keychain 条目。
- **BREAKING（安全模型）**：本地配置中的凭据为可读数据，依靠应用目录 0700、文件 0600 和操作系统账户权限保护；有权以当前用户身份读取这些文件的进程可以读取凭据。
- 旧 `$siCredential` / `$siProtectedText` 数据保留可恢复迁移路径；日常启动不隐式启动交互式凭据迁移。
- 旧凭据只在用户明确启动迁移时读取并持久化已成功迁移的文档；拒绝、中断、磁盘满或并发写入时保留原数据与进度。旧条目数量较多时迁移可能仍需多次系统授权。
- 支持通过现有配置导入/重新填写替代不可访问的旧凭据；迁移后正常启动、重启和配置切换不读取 Sivio 自有 Keychain 条目。
- 保留默认导出/云同步去秘密、显式含秘密导出加密、日志脱敏及 helper 权限边界。

## Impact

- 本提案获批后替代活动提案 `add-unified-ai-macos-app` 的 F31 中“Keychain 保存新凭据”“钥匙串锁定阻止本地凭据读取”及“不可明文存储”的相关约束；F28/F29/F30 的迁移、备份、同步边界相应补充。
- 主要代码：`credential_vault.rs`、`database/credentials.rs`、`settings.rs`、`network/repository.rs`、本地文件写入/备份、导入恢复及迁移状态界面。
- 状态：用户于 2026-10-19 明确批准“开始执行”；实施中，真实凭据仅由用户在新版本中主动迁移。
