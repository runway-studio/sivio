# SI Assist 实施记录

更新于 2026-10-16。用户已授权持续实现完整提案；当前是业务应用的实现与验收阶段，不再仅有 M0 样条。**完整功能对等验收尚未通过**。Intel 真机缺失按用户要求保留未通过；测试账号 live 验收由用户选择稍后登录，当前保留待验收，不在聊天中索取秘密。

## 实际应用

`app/` 是唯一 Tauri 宿主，复用固定 CC Switch 业务适配器，加入独立网络领域与确认的 SI Assist 设计/Logo。AI 供应商、十工具配置适配、客户端发现安装、MCP、Skills、提示词、项目、会话、用量、授权、路由/聚合、WebDAV/S3 页面和后端已接入；这些入口不等于每一项均已全矩阵验收。

网络工作区已实现配置 CRUD/导入导出/修订冲突检查、订阅获取与定时更新、失败保留最后有效修订、运行配置预览、Merge/规则/节点/分组/DNS/受限 JS、节点选择/测速、连接关闭、规则与日志观察、固定 stable/Alpha、独立服务安装修复卸载、TUN、系统代理/PAC、HTTP/SOCKS 端口及认证 LAN。网络设置与订阅正文归入同一 SQLite 快照，以不可变 Keychain 引用保护；本机旧 catalog 已有迁移路径。订阅支持独立的 Merge/序列/脚本和 DNS 来源，增强配置在订阅更新后保留。配置切换/修改需停止运行；订阅更新的专用事务允许校验后重启，失败尝试恢复原修订和运行。

AI Router 新安装默认端口 16721，使用独立的 SI Assist 托管标记/模型目录，避免误认原 CC Switch 的客户端配置。AI 出站支持 direct / managed-network / custom-proxy，单次转发尝试固定出口；managed-network 逐请求检查自己的控制通道，不可用时失败，不静默直连。

`native/helper/`、`native/sysproxy/`、`native/kode-bridge/` 为独立可审计移植；生产 service ID `local.siassist.desktop.service`，socket `/var/run/si-assist-service/service.sock`。不会卸载原 Clash 服务。调用方校验使用内核 audit token 与管理员登记的代码 CDHash；核心固定摘要，root 私有控制 socket，通过封闭的会话控制 API 操作。root 配置边界二次校验与文件/进程沙箱均失败即关闭。普通内核由 stdin 生命周期守护器回收。

## 已有真机证据（Apple Silicon / macOS 27）

| 场景 | 结果/证据 |
| --- | --- |
| 独立服务原生授权安装、续约 | 已执行；`build/reports/helper-install-sandbox-final.log`、`helper-renew-live.log` |
| 未续约自动停止、旧 proof 拒绝 | 已通过；`helper-expired-status.json`、`helper-expired-renew.log` |
| 有效 lease 下强杀 helper / launchd 重启 | 已通过，owner generation 保留、内核 PID 更新、HTTP 恢复；`helper-real-crash-recovery.json` |
| 过期 lease 下冻结 35 秒后强杀 / 重启 | 已通过，内核停止、旧 proof 续约拒绝、代理恢复；同上 |
| 真实 TUN HTTP 与 DNS 劫持转发 | 已通过，仅路由保留测试网段，停止移除测试 utun；`helper-sandbox-tun.json` |
| 系统代理精确恢复原 Clash 配置 | 已通过；`helper-real-proxy-recovery.json`、`helper-real-crash-recovery.json` |
| root 私有 socket 与任意配置重载拒绝 | 已通过；`helper-sandbox-tun.json` |
| 运行目录外文件/符号链接读取拒绝 | 已通过；`runtime-sandbox-tests.log` |
| 普通 GUI SIGKILL 后内核回收 | 已通过，原测约 0.144 秒；`ordinary-gui-crash.json`；沙箱版尚待复验 |
| 原生业务界面保存 YAML、启动普通内核 | 已观察成功；后续最终包须再复验 |

helper 崩溃测试首次断言误用了 `running` 字段，已修为实际协议的 `is_active`；在同次真实崩溃后再次核对停止状态、失效 proof、代理原文一致。报告保留该修正说明。

## 测试与打包状态

- 早期 AI provider/OAuth/session 范围 1153 项单元回归通过；使用测试内存 vault，不替代真实 Keychain/OAuth。
- 导航回归 21 项、Pi 表单 48 项已通过。第一次前端全集 216/218 文件通过；其余导航旧键/首屏夹具与重负载超时已定位并单独复验通过，全集待最后重跑。
- Rust 主体单线程回归已有 3715 通过、9 忽略，见 `app-argon2-unified-regression.log`。新增配置恢复 CAS 与订阅独立增强后正在执行更新回归；沙箱禁用回环监听造成的一轮失败不计产品缺陷，已经在允许本地夹具监听的环境中验证。
- `scripts/build-app.py` 构建实际业务应用与 ZIP、验证签名、包含源码/许可材料；当前产物在 `dist/internal-aarch64/`。修改后需重新构建，不能把旧包摘要当成最终摘要。
- 已补齐两种 Mihomo 精确版本源码，见 `mihomo-source-manifest.json`；已生成 801 个依赖声明/许可文件台账，继续补齐部分包未携带的通知文件。
- 统一 `.siassist` 配置包、默认秘密排除、Argon2id/AES-GCM 加密、WebDAV/S3 条件发布与不可变 artifact、恢复 journal 和外部修改检测见 `configuration-snapshots.md`。这不是本机 OAuth 会话跨设备复制。

## 仍需完成/验证

1. 完成最终包原生启动、授权中心测试账号登录与真实调用；不在聊天或报告中记录令牌。
2. 完成 T01 上游逐字段/逐操作台账和全部 F01–F36 情景对照，补齐剩余网络/桌面偏好和逐操作验收；已加入两项目的只读预览迁移，详见 `legacy-migration.md`，原 Clash 偏好完整自动映射和真机大型备份验收仍未完成。不能靠已有页面或上游测试推定完成。
3. Keychain 导入/恢复中断、磁盘满、跨设备缺失凭据与同步冲突的完整矩阵；共享连接部分旧 DAO 内仍有同步 Keychain 读写，需继续收紧。
4. PAC/LAN/计划更新的端到端与失败回滚实测、服务卸载重装、普通沙箱版 GUI 强杀复验、睡眠/唤醒与网络服务切换。
5. 自有更新源/公钥设置、签名校验、来源/许可入口已实现，默认尚未配置端点；正式更新通道端到端验收未通过。原生 ZIP 备份保存对话框仍需在新包复验。
6. Intel 正式业务包交叉构建与签名已通过；Intel/macOS12 真机、干净机安装升级卸载、性能/长时间运行矩阵未通过，Intel 真机继续保持未通过。

## 后续补齐（正在回归和重打包）

- 两项目只读迁移、预览绑定来源/目标修订、保留/替换冲突、统一 journal 发布。四项后端迁移夹具与 24 项相关界面回归通过；首次暂存目录和测试内存库列差异已修复。
- 订阅请求的 User-Agent、1–300 秒超时、直连/系统代理/本应用网络出口及逐订阅 TLS 选项已接入；选择受管出口时不可用会失败，不直连。迁移保留这些原选项。
- 新增 Redir TCP 端口、默认测速地址/100–5000 ms 超时、自动分组测速间隔、切换节点关闭连接、节点选择持久化与有界恢复。自动测速在组间释放运行时锁，避免阻塞 helper lease；这些新增行为等待最终回归/原生验证。
- 已有凭据引用改为使用时打开，避免启动时逐条访问 Keychain；导入暂存仍在发布前逐条验证，缺失凭据调用明确失败。启动耗时需新包真机测量，不能由代码调整推定达标。
- 统一前端默认数据目录、Skills 路径和云端前缀；“关于”改为 SI Assist 自有版本/更新配置和随包源码入口。旧包不是这些改动的最终产物。

历史 M0 记录见 `m0-progress.md`，其中“未实现 lease/未安装服务”等是历史状态，不代表当前代码。

## 2026-10-15 后续回归与原生验证

- 最新 Rust 主体全集：3,737 通过、0 失败、9 忽略（`app-revision8-final-regression.log`）。helper 配置/控制边界 8 项通过（`helper-boundary-revision8.log`）。helper 协议升至 epoch 2 / revision 8；App 明确提示旧服务需要修复，仍支持旧 revision 7 客户端连接新服务。
- 缺失凭据占位符在全部增强合成后和 helper 权限边界均被拒绝。默认备份进一步排除 header、PAC/其他脚本和数值型秘密；只根据当前订阅修订的凭据完整性取消恢复后的活动选择。
- 编辑网络设置和 AI 出站策略时，重载/换页先确认放弃；保存期间锁住编辑与导航，设置数据和 CAS 修订来自同一快照。托盘轻量模式先请求 renderer 确认草稿，再销毁窗口；没有响应时不会销毁。
- 外观字体、字号、颜色、受限本地 CSS、通知位置已有持久化和原生托盘恢复入口。React 挂载/销毁 20 轮的事件清理通过；这不替代 20 次真实原生窗口验收。
- 网络工作区新增中英文界面，用户配置名称不翻译。网络草稿/语言、轻量导航、CSS 恢复合计 28 项通过（`network-lifecycle-appearance-regression.log`）。类型检查通过。前端全集 2,863 通过、3 项 Pi 表单 5 秒超时；Pi 单独复跑 48 项全部通过，全集受限并发复验待执行。
- RUN8 原生普通网络实测：通过显式代理下载本地夹具 1 MiB，界面显示真实流量/内存；GUI SIGKILL 后约 0.558 秒回收 supervisor 和 core，系统代理前后原文一致（`native-network-run8.json`）。原生 ZIP 配置导出和导入预览通过；未对用户实际数据库执行有损的凭据排除恢复（`native-configuration-run8.json`）。
- RUN8 热启动实测 63 秒，主线程采样定位于托盘设置加载时读取 Keychain 中误存的布尔偏好。现已跳过布尔加密，并针对旧布尔引用做保留其他字段的原子迁移；首次升级仍需一次旧引用读取。新包启动速度尚待复测，性能门槛未通过。
- 自有更新安装前增加 `.app` 的 bundle ID、版本、Mach-O CPU 和签名验证；4 项受控包验证通过。构建增加 `.app.tar.gz` 更新产物，默认无发布通道、公钥或更新签名；不能用于外部正式发布。

Intel 真机继续未通过；用户选择稍后登录，真实 OAuth/调用保持待验收。全部 OpenSpec 任务仍按完整验收条件保留，不能把本轮改进视为完整对等验收完成。

## 2026-10-16 桌面与服务恢复补齐

- Apple Silicon / macOS 27 的 helper revision 8 实测已完成：用户在系统窗口授权安装；受控 TUN HTTP/DNS 正常；持续超过 4 分钟续约；节点切到 REJECT 后请求失败，停止/重启后仍恢复 REJECT；改回 Fixture 后通过固定维护入口强杀 helper，有效 lease 下 launchd 重启服务、新内核和 HTTP 恢复；冻结 35 秒再强杀后，过期会话未复活，内核/TUN 被回收。原有系统代理及 utun0–5 精确保留。报告 `native-tun-revision8.json`、`helper-revision8-installed-version.json`。结束时已保存 TUN 关闭、系统代理关闭、网络停止。
- 新增桌面偏好：启动页、自动轻量分钟数、托盘左键行为、模板/彩色自有 Logo、十项全局快捷键。使用固定官方 `tauri-plugin-global-shortcut 2.4.0`；冲突或数据库 CAS 失败会回滚原有按键注册，前端保存失败保留草稿；启动注册和设置保存串行。自动轻量仅在失焦时计时，renderer 遇草稿/进行中操作跳过。
- 托盘新增本应用网络子菜单：打开工作区、启停、模式、系统代理/TUN、订阅、节点选择。主线程只读有界缓存，不打开 Keychain 或等待内核。菜单绑定缓存修订及内核 generation，旧菜单不会把索引映射到另一个节点；完整列表仍可在工作区访问。默认托盘图改为已确认的 SI Assist SVG 轮廓导出。
- 上述主体 Rust 全集 3,740 通过、9 忽略（`app-desktop-tray-final-regression.log`）；前端全集 224 文件 / 2,871 项通过（`app-desktop-tray-ui-fixed-regression.log`）。一次跨午夜会话测试夹具错误已修为固定本地中午，仅模拟 Date，不改变生产时间分组。新增两个状态反馈改进后，类型检查和 32 项针对性前端回归再次通过；对应原生检查/回归进行中。
- 已补逐字段实施映射 [preference-coverage.md](preference-coverage.md)：75 项中 38 项接入待完整验收、14 项部分完成、21 项待补、2 项为 macOS 不适用。该清单明确保留自定义图标/菜单排序、显示偏好、启动脚本、外部控制面板等剩余工作。不能标记完整集成完成。
- 依赖台账刷新至 806 个包、0 个许可声明缺失；11 个许可文本仍待补。命令行联网请求的自动审批两次超时（没有执行下载），只读网页工具连接也失败；继续使用缓存依赖离线检查/打包，许可材料保留未核齐状态，不据此宣称可正式外部分发。

Intel 真机仍未通过；真实账号登录按用户选择暂缓。不将以上真机结果推广为 Intel/macOS12、长期运行、干净机升级卸载或所有故障矩阵均已通过。

### 2026-10-16 桌面与展示偏好补齐（新包待原生回归）
- 新增 13 项基线偏好实际行为，映射见 preference-coverage.md；剩余缺项仍保留，不宣称全功能验收完成。
- 节点 60 行分页，1000 节点最后一项可选；hover 定时器离开/改偏好/卸载均取消，3 项回归通过。
- macOS 保留快捷键预检查、原生 Tools 菜单和退出草稿握手已编译；原生 20 次窗口销毁重建仍待执行。
- 前端此前定向 30 项通过；新测试与源代码将重新验证并打包。

### 2026-10-16 原生窗口循环与后续修复
- RUN11 原生 Tools → 轻量模式 → 重新打开共 20 次；日志进入/销毁/重建各 20，进程始终 72254；证据 native-window-cycles-run11.json。约 4.5 MiB RSS 差异不等于已证明长期无泄漏。
- 发现 macOS Command-Q 不发送 Tauri ExitRequested，先前握手只覆盖 Rust 退出入口；现加入现有 AppKit delegate 的 applicationShouldTerminate:，不替换 Tao 其他生命周期方法。原生修复验收待新包。
- RUN11 首次启动日志耗时 60 秒；network::setup 原先同步解密网络仓库，改为后台初始化，初始化期间禁止网络写入、AI 出站保持 unavailable；不能显示空目录后意外覆盖原配置。新包冷启动验收待执行。
- 普通 supervisor 日志新增 2 MiB + 1 归档上限，超长记录整条省略再脱敏，防止截断敏感值造成匹配遗漏；helper 内核归档从 8 减至 3。新增轮转/年龄/符号链接/超长输入 2 项单测通过，沙箱内完整 supervisor 测试的嵌套 sandbox-exec 用例未通过，需宿主重跑。
- 新增日志策略、配置变更本机数据库备份和独立授权启动脚本。未宣称剩余偏好/全功能/Intel/live OAuth 验收完成。

### 2026-10-16 网络与托盘剩余偏好源码补齐（尚未交付）
- 75 项偏好逐字段映射更新：73 项源码接入待完整验收、2 项 macOS 不适用；该统计不代表功能对等验收通过，也不代表旧偏好均自动迁移。
- 新增自定义托盘图标及独立开关、菜单栏实时速率、分组与模式菜单布局；补齐自定义网络检测、绕过检查、默认绕过、内置兼容增强和代理守卫偏好。
- 显式 loopback 控制面板桥支持固定 HTTP 操作和流量/内存/连接/日志 WebSocket，独立秘密和精确浏览器来源校验；根 Mihomo 控制器继续使用私有 Unix socket。日志读取按游标保持重复记录，普通日志不跟随链接，超长记录整条省略。
- helper 源码 revision 9：允许校验后的显式系统代理目标及只读有序日志批次，保留 audit token、CDHash、UID/GID、lease、CAS 边界。当前安装仍 revision 8；revision 9 需要新包和实际安装验收。历史 revision 8 的 TUN 证据不替代 revision 9 验收。
- 本轮编译/回归/打包正在进行；不能将 RUN12/Intel 旧产物视为以上新源码产物。

- helper 全集首次漏用专用 `test` feature，23 个状态夹具访问 root 服务目录被权限拒绝；未提升为 root 执行，也未将该结果当作产品缺陷或通过。已将会写服务状态的夹具限定为显式 `test` feature，后续全集在临时目录和独立测试 socket 运行；生产边界用例仍分别保留。

### 2026-10-16 revision 9 打包前回归结论
- 最终宿主 Rust 单元全集 3,755 通过、0 失败、9 忽略：`revision9-final-native.log`。包含实际回环 HTTP/WebSocket 认证、来源限制、日志游标、链接拒绝、超长记录和代理守卫边界。不能以这些夹具替代真实外部控制面板/TUN 验收。
- 前端 226 文件 / 2,877 项全部通过：`revision9-full-ui-bounded.log`；类型检查通过：`revision9-typecheck-final.log`。第一轮并发参数多传了分隔符，Pi 表单一项超时；限制两 worker 的全集重跑通过，没有放宽测试超时。
- helper 隔离全集：120 个库测试通过、1 忽略；安装器 21 项单元与 2 项参数集成测试通过，其余 owner/reliability/staging/protocol 夹具通过：`revision9-helper-isolated-host.log`。一个要求本机无原版 Clash 内核运行的 sidecar 占用测试显式过滤并保留未通过，不为测试停止原版 Clash。纯生产 proxy/control 边界已有单独报告。修复 maintenance/installer 提前用 UTF-8 参数迭代导致非法编码 panic；仅修夹具输出预期以包含强制 loopback bind-address，未放宽生产约束。
- supervisor 4 项通过：`revision9-supervisor.log`。OpenSpec strict 校验通过：`revision9-openspec-validation.log`。
- 依赖台账 810 个包、0 缺失声明、2 个包缺少完整通知文本：seahash 4.1.0、html-parse-stringify 3.0.1。部分补充上游许可来自稍后版本，适用性仍需法律核对，台账明确记录，不能宣称外部分发材料全部核齐。
- revision 9 新包开始按架构串行构建；本节记录的是源码与夹具结论。安装、原生真实流与最终打包结果见独立 `build/reports/app-*-artifact.json` 和后续原生报告。当前系统仍安装 revision 8。

### revision 9 原生验证与关键状态通知修复
- 用户明确授权安装 revision 9，服务版本查询已确认 epoch 2 / revision 9。RUN13 原生普通内核受控 HTTP 通过；受管真实 TUN HTTP 和 DNS 均通过。持续超过 100 秒保持续约，有效 lease 下强杀自有 helper 后内核 PID 更新且 TUN HTTP 恢复；冻结 35 秒再强杀后，过期内核未复活，测试 utun6 移除。
- 系统代理测量首次混用了沙箱与宿主：受限 scutil 无法访问 configd，返回空字典，该比较无效。保留测量修正记录，重新在宿主获取基线和最终快照；动态代理与持久 Proxies 摘要均相等，utun0–5 保留，宿主代理也与 revision 8 历史基线一致。证据 `native-run13.json`，不把无效比较计作通过。
- 原生发现失焦时 React Query 暂停轮询可能留下过时的运行标记。新增 `network-runtime-changed`，lease/子进程故障与恢复、代理守卫冲突时主动通知界面；只在状态变化时发出，事件不包含凭据，既有异步监听卸载逻辑负责清理。新增失焦期间故障通知回归，NetworkWorkspace 4 项通过，类型检查通过；网络领域回归与最终重打包进行中。
- RUN13 验证结束已恢复 TUN 关闭、系统代理关闭、网络停止并退出 GUI；系统仅保留已授权的 revision 9 helper，处于空闲。最后修复后新 App 的代码身份仍需重新登记，属于本次已授权服务验证范围；Intel 真机与真实账号验收继续保留。

### 最终内部包与原生复验（2026-10-16）
- 最终 Apple Silicon RUN14、Intel RUN5 均完成业务应用打包、Mach-O 架构检查、深度严格签名验证和 ZIP 摘要核对；清单 `final-packages-verified.json`。它们仍是 ad-hoc 内部包，未公证，更新 artifact 没有发布签名，不代表可正式外部分发。
- 最后状态通知修复后网络领域 34 项通过；前端全集 226 文件 / 2,878 项通过。此前宿主 Rust 全集 3,755 项通过、9 忽略；最后改动只增加状态变化事件及监听，受影响领域再次回归，没有把两次不同范围报告混成一次全集结果。
- RUN14 未经 UI 交互强杀其普通内核子进程后，界面主动出现“运行失败”“清理并停止”和 Mihomo exited unexpectedly；清理成功。最终 App 经用户系统认证重新登记到 helper 9，服务界面不再要求登记；helper 二进制与 RUN13 真机恢复验证版本逐字节一致。最终 App 的真实 TUN HTTP/DNS 再次通过。
- 结束时已重新读取持久偏好：TUN 关闭、系统代理关闭、网络停止；宿主动态代理、持久 Proxies 摘要及接口列表与测试前相等，自有 core/supervisor 无残留；仅停止了两个有明确 PID、UID 和脚本路径证据的本次 HTTP/DNS 夹具。证据 `native-run14.json`。已安装 helper 9 保持空闲，原版 Clash 未被卸载或停止。
- 完整提案验收仍未通过，保留任务未完成状态；最终结论见提案 `reviews/implementation-delivery.md` 与 `revision9-delivery-review.json`。Intel 真机、稍后登录的真实 AI 账号和完整操作/性能/故障矩阵等不能由现有回归替代。

## 2026-10-16 性能与故障恢复补验（RUN15，进行中）

- 新增隔离进程恢复矩阵：9 个状态真正 SIGKILL，然后通过 Database::init 启动恢复；已通过。覆盖 journal 前/后、Skills 原目录移走/新树安装、DB 已写/提交、损坏快照、外部改写与符号链接。修复恢复前路径解析会创建空目录的副作用，校验失败保留现场。
- 真实浏览器合成 10,000 会话/1,000 节点夹具，按导航卸载重建测试发现重复索引使切换 p95 418.1ms；有界的单份索引复用后 p95 33.5ms，冷索引337.6ms。节点最多60个DOM项。只算组件证据，不替代完整原生列表验收。
- Rust 全集3757通过/10忽略；前端全集2880通过；最后索引修复另21项通过，类型检查通过。
- 本地100请求 Router 额外开销p95 2.523ms；20次流式取消已释放上游；20路603.72秒流式测试通过：12,000帧，无丢失/串流，结束上游活动数0。
- 原空闲采样期间用户操作了App，且范围包含其他WebKit，已明确标为无效空闲基线。用户随后同意进行启动/静置测试；正式采样改用 launchctl PID domain 精确归属App的XPC服务，最终结果另记。


### RUN16 / Intel RUN7 交付与验证状态
- 已生成两架构内部包，严格签名、Mach-O、ZIP摘要核对通过。清单 `final-packages-verified-run16.json`；helper与RUN13/14真机TUN测试版本字节一致。
- 普通模式600秒空闲CPU1.033%单核、峰值RSS178.91MiB通过；5次前台新进程启动p95 3.311秒通过。原生测试期间用户订阅与网络/桌面偏好摘要保持一致，系统代理与接口等于既有基线。
- 独立64MiB镜像真实ENOSPC与只读目录测试通过；原DB、Skills和文件均未被半写覆盖，镜像已卸载。第一版夹具留有小块空间，已修正后复验，并保留失败记录。
- 原生发现工具菜单并发刷新重复网络项，已将整体替换串行到主线程并清除全部重复直接项。受影响50项测试通过，RUN16启动观察到单一入口。
- 轻量样本0.948%/116.52MiB因两个XPC正常退出而未通过稳定集合规则；第二次因系统休眠中断作废。采样器增加墙钟偏差检测，稳定连续采样仍待完成，不能算整体性能验收通过。
- 用户已完成RUN15 helper身份登记。RUN16新增代码身份后，网络配置读取在Keychain等待授权（线程采样已确认），已请求用户在系统窗口完成；最终helper登记和初始化后的菜单/窗口复验仍待完成。其他工作区可用，网络出站保持不可用而非静默直连。
- 只读核对html-parse-stringify 3.0.1官方npm gitHead，固定源码树不含完整许可文件，未以其他版本文本冒充补齐；许可风险继续保留。当前没有活动采样器或本次测试Vite服务；测试App保留以便用户处理授权。


### RUN16 授权恢复与最终复验续记
- 用户反馈没有钥匙串弹窗后，确认旧进程的系统调用停留在Keychain而没有可见授权进程。正常退出并从Finder前台启动同一包后，SecurityAgent出现；用户完成系统钥匙串授权，订阅列表正常恢复。
- 用户再次完成已授权revision 9的最终App身份登记，原生服务标签不再提示“需要登记当前App”。helper二进制不变。
- 完整初始化及两次轻量窗口销毁/重建后，工具菜单均只有一个网络入口，窗口可操作；网络仍停止。原订阅与网络/桌面偏好摘要一致。
- 最终轻量模式采样改为先稳定130秒，再连续测量600秒，并用限时caffeinate阻止空闲休眠；同时记录墙钟与单调时钟差，禁止跨休眠样本通过。结果另补，不沿用前两次无效测量。
- 用户恢复手册已新增keychain-recovery.md；没有修改Keychain ACL、删除凭据、重启securityd或绕过系统认证。


### RUN16 本轮验证收尾
- 最终轻量样本 `idle-run16-lightweight-final.json`：先稳定130秒，连续600.085秒（墙钟600.092秒），CPU1.2398%单核、RSS峰值93.25MiB；进程集合未变、无时钟跳变，门槛通过。前两次无效样本保留，不混入通过统计。
- 已恢复主窗口，原生显示网络停止；用户订阅与桌面/网络偏好摘要不变，系统代理、网络接口等于原基线，无本次caffeinate或supervisor残留。关闭仅本任务创建的Finder窗口。
- Apple Silicon RUN16 / Intel RUN7产物不变，无需再次改签名。完整提案验收仍未通过；Intel真机、真实AI账号、完整操作组合、干净机生命周期及正式发布条件继续保留。
- 宿主此刻约414MiB可用，未删除用户文件；后续构建需先释放足够空间。此项不撤销已完成的打包与测试结果。

### 2026-10-16 三栏导航改造
- 用户批准 v0.4 交互稿后，正式接入概览/网络/模型一级栏，原二级菜单与八个网络页面，增加领域位置记忆和相应搜索/滚动恢复。
- 前端全集 2,887 项通过；最后设置排序修订后 67 项定向回归通过，TypeScript 通过。原生独立启动、Codex/节点往返、设置返回和折叠通过；原订阅可见，网络保持停止。
- 首个新包发现内置资源协议未显式启用导致白屏，已修构建 feature 并原生验证 `tauri://localhost`；该异常包已被替换。最终双架构包已生成，CPU 架构、严格签名、ZIP 完整性及摘要均通过，两包前端一致；报告为 navigation-v3-packages-verified.json。
- 最后导航操作锁修订后 29 项定向回归通过。最终 Apple Silicon 包已重新打开，原生加载三栏并恢复模型 / Codex 位置，截图已更新；helper 与 RUN16 字节一致。
- 详细交付边界和证据见 [navigation-v3-delivery.md](navigation-v3-delivery.md)。Intel 真机、真实账号、原完整验收仍保留未通过。

### 2026-10-16 订阅新增交互优化
- 新增/编辑配置改为居中弹窗，默认远程订阅，自动更新开关和基本字段优先，下载选项与正文/增强折叠，操作区固定。导入自动下载、验证、保存，失败保留草稿并就地反馈，取消/Escape 保护编辑。
- 类型检查与网络/App 集成 34 项回归通过；原生弹窗、错误提示及 Escape 复验通过。未下载用户订阅或启用网络。
- 两架构 App/ZIP 已重建并通过签名、CPU、完整性、摘要检查。见 subscription-ux-delivery.md 与 build/reports/subscription-ux-packages-verified.json。

### 2026-10-16 独立 Clash 设置与 7890 端口
- 网络设置改为 13 个独立功能编辑入口；模型 AI 出站移至设置/本地路由。加入 IPv6、统一延迟、日志级别、TUN stack/MTU 的有效后端投影及 DNS 覆写开关。
- 新默认混合端口 7890；旧默认 15722 按版本迁移，自定义端口保留。原生确认 7890、两份原订阅可读，网络保持停止。
- 前端 37 项、Rust 网络 36 项、类型检查及 OpenSpec strict 通过。首轮受沙箱限制的 6 项本机测试已在受控环境重跑通过，失败证据保留。
- 两架构 App/ZIP 完成并通过签名、CPU、完整性和摘要校验，helper 不变。详见 network-settings-delivery.md。新 App 身份仍待登记；Intel 真机及完整提案验收状态不变。

### 2026-10-16 网络报错恢复与原版 Clash 并行
- 用户完成旧包服务登记后，定位 7890 被原版 Clash 占用；按用户要求将当前 SI Assist 端口改为 7891，保留原版运行。
- 修复 helper 继承原版内核执行锁的问题，macOS 锁改为 SI Assist 自有命名空间，仍保持内部跨进程互斥；helper revision 10 已由用户认证安装。服务缺失/升级/未登记提示更明确，操作错误保留在页内。
- 8 项锁测试、36 项网络 Rust、36 项 UI/App 回归及类型检查通过。两架构 App/ZIP 已重建并校验。
- 从原版 Clash 同名缓存恢复 AgentNEO 的 31 节点/9 分组；7891 受管运行与原版 7890 并存。实际 HTTPS 204、无凭据 AI 端点 401 通过；停止 SI Assist 后恢复原版 7890，原版 PID 未变，随后重新启动 SI Assist。
- 在线订阅刷新、revision 10 TUN/崩溃恢复与 Intel 真机等未完成项仍保留。详见 network-coexistence-recovery.md。

- 并行修复最终复验：快速重启曾遇到一次临时端口占用，稍后恢复；自动节点切换后一次TLS失败，固定到已验证的美西直连1后 HTTPS204/无凭据AI401再次通过。最终7891受管运行，原版7890保留，截图coexistence-running-7891.png；短间隔重启与自动节点质量仍需专项验收。

## 外部系统代理与独立网络修复（2026-10-16）

- 代理守卫外部修改（包括全部关闭）只暂停接管并提示，不设置内核错误；停止清除旧提示。运行页增加使用当前 generation/会话的显式重新应用系统代理，不重启内核，沿用 helper CAS 恢复与回滚基线。
- 端口检查补充本机连接探测，覆盖 macOS LAN 通配监听与具体地址监听并存边界；中文错误指出具体冲突端口，保留现有进程。正常关闭连接后的即时复用纳入回归；已核实旧 Rust 接口本身启用 SO_REUSEADDR，历史误报根因不直接归因于 TIME_WAIT。
- 类型检查、38 项网络/App 界面测试、39 项网络 Rust 回归、OpenSpec strict 通过。源文件不再修改，Apple Silicon 包已生成，Intel 交叉构建进行中。helper revision 10 二进制保持不变（摘要已比对）。
- 新 App 配置加载线程采样证实等待 Keychain，已请求用户在系统窗口授权。真机“外部关闭 / 不重启重新应用 / 连续停止启动”待授权后执行；不将 mock 结果代替真机验收。Intel 真机未通过，AI 真实账号登录仍延后。
- 证据索引：network-coexistence-recovery.md；build/reports/proxy-independence-regression.json、proxy-independence-network-tests.log，最终打包与真机证据随后补录。

## 最终验收结论（2026-10-16）

最终包通过本轮修复验收。代码与验证已经完成，当前 SI Assist 保持 7891 独立受管运行；原版 Clash PID 73042 / 7890 全程保留。

- 40 项网络 Rust、38 项界面回归、类型检查和 OpenSpec strict 通过。双架构最终包均通过严格签名、全部内置可执行文件 CPU、ZIP 校验与摘要、相同前端校验；helper revision 10 与修复前基线二进制摘要相同。
- 最终包连续三轮正常停止并快速启动均成功，各轮实际 HTTPS 经 7891 返回 204。第一轮重启前仍捕获到 root 旧连接 TIME_WAIT，uid 501 试绑定 errno 48；最终服务模式能启动，证明不再因 App 权限层试绑定误判而阻塞服务。
- 最终包外部关闭全部 HTTP/HTTPS/SOCKS 后，经过 38 秒以上和守卫检查，PID 13417 仍监听 7891，HTTPS 204；界面显示非致命状态，不再把代理所有权变更当作内核错误。
- 显式重新应用后系统代理回到 7891，PID 13417 不变，HTTPS 204；页面警告清除。正常停止恢复全关闭基线，未重新开启旧 Clash 系统代理；停止页无旧守卫提示。
- 最终截图：build/reports/proxy-independence-final-running.png；外部关闭截图：proxy-independence-external-disabled.png。结构化断言：proxy-independence-regression.json、proxy-independence-machine.json、proxy-independence-packages-verified.json。首轮未通过重启的记录保留并标注为修复前迭代，不计最终通过。

剩余边界：macOS 系统代理本身为共享设置，外部关闭后不抢回；需要系统流量走 SI Assist 时点击“重新应用系统代理”，内核与显式 7891 连接持续可用。Intel 真机继续未通过；真实 AI 账号登录延后；TUN 本轮未复测；内部包临时签名且未公证。在线订阅刷新与完整提案验收仍沿用此前未完成状态，不计入本次修复的通过范围。


## 2026-10-16 运行中应用网络设置

按用户要求实现运行中保存端口和网络设置、自动重新应用与失败回滚；停止状态保存保持停止。配置在候选网络就绪后提交，过期/并发请求、外部代理接管、恢复失败状态均有保护。网络回归 56 项（包含隔离真实 Mihomo 的端口/DNS 与流量切换/回滚）和界面 18 项通过；详细范围、全量前端首轮失败与复测记录见 [本轮交付说明](live-network-settings.md)。未调用已安装 helper、未修改用户配置/系统代理；helper/TUN 真机切换本轮未测试。

### 2026-10-16 流量卡顿修复

- 流量与内存读取分离，等待指标时释放 App runtime mutex 和 helper lifecycle lock；受管读取前后仍验证会话，迟到代次拒绝。服务升级为 revision 11，新包受管模式需在网络设置执行一次「安装 / 修复服务」。测试未更改已安装服务或系统代理。
- 实际固定 Mihomo 采样周期约 3003ms → 1054ms；曲线使用最多60个真实点，按最近60秒平滑滚动，逐帧只更新SVG。内存5秒刷新，遵守后台、减少动态效果和资源清理偏好。
- 流量/网络界面27项、helper 123项通过；网络首轮59/60、失败的真实恢复测试单独复核通过；全量UI首轮2900/2910，失败文件单worker复核133/133通过。类型检查、本轮格式、OpenSpec strict及隔离浏览器性能验证通过；全量格式的5个范围外文件问题保留。详情见 [流量性能修复](traffic-performance.md)。
- Apple Silicon 新内部 App、ZIP 与更新归档已生成，严格深度签名、架构、归档完整性、包内关键源码及新前后端内容校验通过，证据 `build/reports/traffic-packages-verified.json`；未公证。未安装新版 App/服务。Intel真机与完整提案验收仍未通过。

### 2026-10-16 网络易用性与凭据授权优化

- 修复二级菜单经典滚动条下的横向溢出；网络启停移入二级菜单底部，共享一次运行状态；位置栏及网络页头接入拖拽区域，交互控件正常使用。
- 按固定 Clash Verge 的逐节点批量思路修复测速，4并发、逐节点状态、迟到代次拒绝和离开取消排队；支持分组吸顶/手动置顶、排序、折叠、跨60条分页定位当前节点。helper revision 12需一次安装/修复升级，本轮未动已安装服务。
- Keychain不可变引用增加有界成功缓存，读取前检查解锁状态，锁定时清缓存；配置读取失败停止自动重试。内部包改用稳定本地证书与证书+标识约束，保留Hardened Runtime，旧条目首次仍可能需一次「始终允许」。独立钥匙串跨两版可执行文件读取成功，无关签名和锁定读取被拒绝；没有放开真实条目权限。
- 最终定向界面45项、App/托盘导航33项、原生网络62项另加1项旧helper版本门槛、凭据8项、helper124项通过（helper另1个原有忽略项）；类型检查、本轮格式和OpenSpec strict通过。真实Keychain隔离实验与浏览器布局验证通过。详情见 [网络易用性优化](network-usability.md)。
- Apple Silicon内部交付路径为 `dist/internal-aarch64/Sivio.app` 及同目录ZIP/TAR；最终构建、深度严格签名、解压后换目录校验、篡改拒绝、关键源码一致性与归档摘要见 `build/reports/network-usability-packages-verified.json`。本机仅登记公开签名证书供查找，私钥不进入用户查找列表，无系统信任或真实凭据ACL变更。新版物理窗口拖动、登录钥匙串真实旧条目升级、已安装revision12服务/TUN、Intel真机及完整提案仍不据此验收通过。

### 2026-10-16 概览页 Sivio 平台信息补齐

- 概览页移除遗漏的 SI ASSIST 名称与旧介绍，改为 Sivio 标志、名称、Your Shortcut to AI 和中英文平台说明。名称及标语复用全局 app.title / app.description，与关于页保持一致。
- 仅调整概览头部展示，保留统计卡片、网络管理和 AI 工具入口。App/领域导航28项通过，类型检查和单文件格式检查通过；Chromium实际组件+隔离IPC验证中英文、1280px/624px内容宽度、图片加载、无横向溢出及原导航。夹具从生产源码删除，证据在 build/reports/overview-branding-*。
- Apple Silicon 内部交付路径仍为 dist/internal-aarch64/Sivio.app 及同目录 ZIP/TAR；构建与签名、包内新概览源码、归档完整性及摘要最终核验见 build/reports/overview-branding-package.json。保持本地稳定签名，未安装或操作用户 App、凭据及网络服务，未公证。

### 2026-10-16 参考配色的三层窗口布局

- 一级64px浅灰图标栏、二级248/72px灰白目录、三级白色内容；二、三级置于共同16px圆角工作区，细边框、轻阴影、右下8px留白。统一44px拖拽顶栏预留原生窗口按钮位置，紫色主色不变；深色保持对应中性背景。
- 复用原导航与运行状态，新增纯展示WorkspaceFrame，侧栏动画按实际窗口内位置对齐。35项界面回归、真实组件隔离浏览器的明暗/中英/960px布局和收起动画检查通过；物理窗口拖动未复测。
- 交付与证据见 [三层布局说明](shell-layout.md) 和 build/reports/shell-layout-package.json；Apple Silicon内部包使用原稳定签名，未公证、未安装或操作当前网络服务。

### 2026-10-19 概览工具 Logo 与网络首页

已将概览工具首字母替换为 AppGlyph 本地品牌图标，并增加网络二级首页，接入上游九类业务卡片、卡片显隐、真实状态及快捷事务。参考源码、行为边界和证据见 [网络首页说明](network-home.md)。57 项 UI/集成、2 项原生边界、类型/格式/OpenSpec 与生产前端构建通过。自动审批服务持续因模型容量不足无法完成本机预览和签名打包审批，相关命令未执行，新版 App 尚未生成；保留旧包，不声称已更新。


## 2026-10-19 本地凭据存储

用户批准参考 CC Switch 改用本地 SQLite/JSON，替代 F31 原逐字段 Keychain 存储策略。普通路径不再访问自有钥匙串，旧数据通过显式、可暂停/恢复的迁移入口处理，保留原始备份和旧条目；本地文件使用0700/0600权限，普通导出继续去秘密，含秘密云备份保持认证加密。实现与验证边界见 [本地凭据存储与旧数据迁移](local-credential-storage.md)。真实凭据迁移须由用户在新包中主动执行。
