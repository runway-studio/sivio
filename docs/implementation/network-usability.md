# 网络导航、节点测速与凭据授权优化

2026-10-16，按用户的五项要求实施，属于已批准 F01/F02/F21/F31 的修复与补齐。当前仍不代表原完整提案通过验收。

## 用户可见行为

1. 二级菜单只允许竖向滚动。移除固定 202px 行宽，按钮使用目录可用宽度并正确截断长名称，避免经典滚动条挤出横向滚动条。网络、概览及共用设置目录保留原有菜单样式。
2. 网络区唯一开关位于二级菜单底部，状态、端口和错误一起显示。收起后保留可访问名称与悬停提示。`NetworkRuntimeProvider` 共享一个 snapshot 查询及一次启停状态，不因切换网络页重新创建控制器；单独使用工作区时仍有 fallback 控制器。保存期间的现有保护继续有效。
3. 三级内容的顶部位置栏带 Tauri 拖拽标记，网络页复用已有 `AppPageHeader`。标题和空白区域支持拖动，交互控件不设拖拽标记，Linux 的现有禁用策略保持原样。
4. 节点页从大工作区提取为局部业务组件。测速结果直接显示在节点上：实测毫秒、测速中和独立错误，显示协议与 UDP 能力。支持分组标题吸顶、手动置顶常用分组、默认/延迟/名称排序、展开收起及跨分页定位当前节点。置顶、折叠、排序按配置档案保存在本机 UI 偏好，不存凭据。保留每组60条分页、列数和 hover 导航偏好。手动选择仅对核心支持的 Selector/URLTest/Fallback 开放。
5. 凭据仍放在原 macOS Keychain 服务与不可变引用中，未迁移或删除条目。成功读取使用最多512项/8MiB的进程内 LRU 缓存，并合并并发读取；缓存退出/淘汰清零。每次凭据读取前用非交互 `SecKeychainGetStatus` 核对默认钥匙串是否解锁，观察到锁定时清空缓存并拒绝读取。失败不缓存为成功，不落明文文件。网络配置读取失败时停止自动轮询与自动重试，显示显式「重试读取配置」，避免后台不断唤起授权。

## 测速实现依据与边界

对照固定 Clash Verge `proxy-groups.tsx`、`proxy-group-tools.tsx`、`services/delay.ts` 和 Mihomo `hub/route/{groups,proxies}.go`。原界面将组测速响应放在原始 JSON 中，没有更新节点卡片；同时 App 与 helper 的请求等待会持有生命周期锁。组 API 还会对部分自动组重置强制选中状态。现在参考上游逐节点批量方式，用全页共享的4并发队列，逐节点接收成功或失败，批次结束后才发布延迟排序快照，避免卡片在测速时跳动。相同节点的在途请求复用；同组重复点击不会重复发起批次。

Native `delay` 命令验证 HTTP(S) URL、无 URL 凭据/fragment、100–5000ms 超时（沿用现有配置约束）、节点名及 generation。按 URI path segment 编码节点名，读取前拍下控制目标，等待时释放 runtime mutex，返回前再次核对运行代次。离开、改 URL/超时/代次后停止排队并忽略迟到数据；已经发出的 Tauri 请求只能有界完成。

helper revision 12 将**精确、只读且受超时限制的单节点 delay 请求**也放到生命周期锁之外，仍在读取前后校验 owner/session proof。没有开放任意控制端点、重载配置或取消 helper 身份校验。受管模式需一次「安装 / 修复服务」更新到 revision 12；本轮没有安装、替换或操作当前已安装的服务/用户网络。

## 钥匙串授权原因与稳定签名

截图对应 `local.siassist.desktop.credentials`，与安装网络服务的管理员授权不同。此前内部包使用 ad-hoc 签名；每次代码变化后的 CDHash 变化，使旧条目看到不同的调用身份。后台目录反序列化又反复读取相同凭据，加重了弹窗问题。

构建现在为最终 App 使用持久的本地内部签名身份，显式 DR 约束**应用标识和指定叶证书**，保留 Hardened Runtime 与原 entitlements。若用户显式设置 `SIVIO_CODESIGN_IDENTITY` 则优先使用其身份；不会自动挑选其他账号/组织的身份。私钥和构建钥匙串仅位于排除打包的私有 `build/cache/codesign`，使用独立 keychain，创建后从用户搜索列表移除该自有条目。临时 PEM 私钥和 PKCS12 导入后删除。私有缓存必须保留以维持后续构建身份；公开分发仍需要自己的 Developer ID/公证流程。

本机另在 Sivio 数据目录 `~/Library/Application Support/SI Assist/signing-metadata/public-signers.keychain-db` 登记**仅含公开签名证书**的独立钥匙串，并加入用户证书查找列表，使安装包解压到其他目录后仍能解析同一签名身份。该存储保持锁定，无私钥、密码或凭据；没有增加系统根证书信任、写入 SecTrustSettings 或修改登录钥匙串 ACL，也不允许任意同 bundle ID 的程序读取凭据。换目录验证及修改 Info.plist 后的签名拒绝实验均通过。公开证书查找与构建私钥存储分离，此内部流程只验证本机构建和使用。

Apple 说明 Keychain 使用 designated requirement 跟踪应用，稳定身份可以使用自签名证书，具体机制见 [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。旧 ad-hoc 条目第一次由新签名访问时仍可能需要用户选择一次「始终允许」，程序不能代替用户批准这一动作。锁定钥匙串仍须用户自行解锁。未在用户真实条目上承诺或测试无弹窗迁移。

## 验证证据

| 范围 | 结果与证据 |
| --- | --- |
| 界面、目录、流量与编辑保护 | 最终7个文件45项通过：`network-usability-ui-tests-final.log`；包含4并发、部分失败、旧代次/URL、离开取消排队、1000节点分页和定位、置顶持久、唯一启停、拒绝读取不自动重试、拖拽属性 |
| 原 App/托盘/导航回归 | 3个文件33项通过：`network-usability-app-regression.log`，真实 React hooks + 隔离 IPC |
| 原生网络 | 62项通过、0忽略：`network-usability-native.log`，包含真实 pinned Mihomo 对中文/空格/加号节点测速、200ms本地上游、运行锁响应、旧代次拒绝，以及此前端口/DNS应用与失败恢复；额外1项已授权旧helper版本门槛测试通过（`network-usability-helper-gate-native.log`） |
| 凭据缓存 | 8项通过：`network-usability-vault-tests.log`，不可变引用、并发一次读取、失败重试、容量/字节上限、锁定失效 |
| helper 边界 | 124通过、1个原有忽略项：`network-usability-helper-tests.log`，精确 observation 白名单与读取后 session 复核 |
| 实际 Keychain/签名对照 | 两个变更内容的 C 可执行文件在独立临时钥匙串验证，系统交互禁用：ad-hoc升级后读取被拒绝，固定证书两版均读取成功；同bundle ID无关签名和锁定后的读取均被拒绝。`network-usability-keychain-identity.json`，测试脚本在 `scripts/validation/`，不读取真实秘密 |
| 浏览器布局 | Chromium实际组件+合成IPC，1280×900 / 960×720 / 960×480（额外压力）均无菜单/内容水平溢出；经典滚动条预留宽度，收起外宽72；启停唯一；吸顶贴合内容滚动区；离开无新增排队测速。`network-usability-browser.json` 及 wide/narrow/collapsed 截图 |
| 静态检查 | 最终 TypeScript、本轮18个TS/TSX文件Prettier、Python编译、OpenSpec strict通过。未扩大修改其他文件的格式问题 |

浏览器夹具和旧源码对照只留在 `build/reports`；生产入口与对应源码的 app/src 不含本轮夹具。浏览器仅验证拖拽目标标记，没有执行新版 App 的物理窗口移动；没有在本机登录钥匙串或已安装特权服务上做升级试验。Intel真机、macOS12全矩阵、完整功能对等、公证仍未通过。

## 交付

Apple Silicon 新内部 App、ZIP 与更新归档位于 `dist/internal-aarch64/`。严格签名、解压到新目录后的签名、篡改拒绝、ZIP/TAR 完整性及关键源码一致性核验记录在 `build/reports/network-usability-packages-verified.json`，可用 `python3 scripts/validation/verify-network-usability-package.py` 复核。本轮不替换正在使用的 App，不安装服务，不发布或提交 Git。
