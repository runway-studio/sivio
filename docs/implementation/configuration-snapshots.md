# 统一配置快照与恢复

2026-10-15 实施补充；不代替 F28–F33 的完整验收。

网络目录、订阅正文、出站配置归入现有 SQLite `settings.si_assist_network`，使用原始记录摘要做 CAS，敏感正文只落不可变 Keychain 引用。元数据和正文随同一份 SQL 快照提交/恢复；helper proof、PID、控制 socket 和运行材料没有写入此记录。自身旧 catalog 是迁移输入，不读取原 Clash 的数据作为活动库。

默认可移植导出打开本机 Keychain 引用后，剔除管理的秘密，写入明确的待补凭据标记；不把无法跨设备读取的引用上传。需要凭据的 provider 不保持 active，MCP/网络/路由遇到待补标记明确拒绝运行。未知自定义配置结构保留；命令参数、订阅原始 URL 和自定义脚本可能需要重新填写。已知凭据形状的用户文本/Skill 资源会阻止明文同步，要求移除或选择加密；该检查不能证明任意用户文件不存在未知形式的秘密。

包含凭据时，SQL 与 Skills 分别使用 `SIENC002` 封装：Argon2id v19，内存 65,536 KiB、迭代 2、并行度 1，派生 32 字节 AES-256-GCM 密钥。每个 artifact 独立生成 16 字节盐、12 字节 nonce；完整版本头与 artifact 名纳入 AAD，认证失败不进入恢复。参数只允许本版本固定值，拒绝未经认证的任意内存/迭代参数。口令至少 12 字符、最多 1,024 字节；默认仅当前应用会话保留，只有用户勾选时才写入 Keychain。

实现使用 [RustCrypto Argon2 0.5.3 的 key derivation API](https://docs.rs/argon2/0.5.3/argon2/) 与 ring AES-GCM。固定派生向量来自该固定版本 `tests/kat.rs` 的 `reference_argon2id_v0x13_2_16_1`（password / somesalt，输出 `09316115…913cf7`）；另测错误口令、篡改、artifact 互换和随机化。临时 PBKDF2 实验封装未作为发布格式保留。

WebDAV/S3 使用自身 `si-assist-sync` 前缀和 format。每次上传先核对上次读取的 manifest 摘要，再写入内容摘要命名的独立 artifact，最后以 If-Match / 首次 If-None-Match 条件发布 manifest。S3 条件头参与 SigV4 签名。已有远端快照但无匹配本地父修订、服务未返回 ETag、HTTP 412 均不覆盖 manifest。失败上传可能留下未引用对象；当前没有自动删除旧对象的保留策略，避免误删仍被其他快照使用的数据。

配置包导出先写同目录 0600 临时文件，校验并同步后原子发布。恢复在停止自身 AI 路由和网络后，先验证 manifest、artifact 大小/摘要、解密、SQL schema 和 Skills 归档；包修订须与用户预览一致。恢复期间用 `pending-restore` 私有日志保存原数据库和 Skills。已提交/旧版的已知修订才允许自动回滚，外部改动或恢复快照校验失败保留现场并停止；数据库最后提交再次核对基线修订。备份清理分类不会清理 `pending-restore`。

剩余矩阵：真实 Keychain 拒绝/中断、磁盘满、真实进程强杀恢复的逐点注入、跨设备登录账号重绑、远端断点失败及不同 WebDAV/S3 实现兼容。当前本地 HTTP 服务夹具已经覆盖两种传输往返、修订冲突、条件发布失败、秘密排除和加密恢复；新增并发恢复边界继续回归。
