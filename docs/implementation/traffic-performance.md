# 流量页面刷新与平滑滚动修复

2026-10-16。属于已批准提案 F25 实时流量观察的缺陷修复，保持现有 Tauri / React Query / SVG 与封闭 helper 控制边界。

## 原因与实现

- 固定 Mihomo 源码 `hub/route/server.go` 的 traffic 首帧要等 1 秒，memory 第二帧才是真实值，要等 2 秒。原实现把两者 join 后统一返回，再由 React Query 等 1 秒重取，形成约 3 秒的刷新周期。
- `network/metrics.rs` 拍下运行代次、会话与 socket 后释放 runtime mutex，独立读取流量或内存，返回前检查运行代次。保留不带 metric 的原组合响应，未扩大可访问端点。
- `useNetworkTraffic` 保留 React Query 的请求去重、缓存生命周期和错误处理。流量目标周期 1 秒，扣除请求耗时后仅保留 50ms 最小间隔，避免额外等待；内存目标周期 5 秒，关闭内存卡片时不采样。
- helper 的流量/内存读取原先还占用 owner lifecycle lock，会拖慢其他采样、状态、停止及 lease 续约。现在只允许精确的无 body `GET /traffic` 和 `GET /memory` 在锁外等待；读取前后均验证 active owner 和 session proof，重启/接管后的迟到数据不返回。其他控制操作保持原有互斥。
- helper protocol revision 升为 11，客户端要求服务至少 revision 11。新版包带有更新的服务；使用受管模式前需在网络设置执行一次「安装 / 修复服务」，完成系统授权。当前已安装的服务与系统代理没有在测试中被修改。
- `NetworkTrafficChart` 使用最多 60 个真实样本、60 秒时间轴，新数据在右边进入。独立 rAF 只更新两条 SVG path，不推动 React 每帧渲染。形状保持的三次曲线控制点不超出相邻样本值域；1 秒滚动和短暂平滑缩放只改变展示，不生成业务采样或积分累计流量。
- 缺失超过 2.5 秒的样本不连线；停止/新代次清空曲线；流量错误保留过期图并提示，内存错误不拖垮流量。后台默认暂停新请求，关闭该偏好时允许后台采样但停止动画；卸载释放定时器、媒体查询与可见性监听。不可取消的在途 Tauri 请求只允许有界完成，离开页面不发新请求。减少动态效果时静态绘制。

## 复用取舍

沿用当前查询库、偏好 Hook 和流量面板；仓库 Recharts 用于低频用量统计，不负责独立连续滚动。上游 Clash Verge 的常驻 WebSocket + Canvas/worker 方案用于多消费者历史压缩，本页只有 60 点，不引入该基础设施。局部图表组件负责动画资源，业务 Hook 负责采样；数据模型与路径转换放在相邻纯 TS 文件。生产入口不包含合成数据、开发基准页或 IPC mock。

## 验证

- 实际固定 Mihomo v1.19.32 + 私有临时 Unix socket：原采样平均间隔约 3003ms，独立采样约 1054ms，并行内存读取仍有有效结果。见 `build/reports/traffic-native-cadence.json`。这是读取层与调度间隔对比，不是实际 root 服务/TUN 的实时测量。
- Rust 指标边界测试覆盖慢内存与 runtime mutex、迟到响应、停止/重启代次、旧组合接口；包含上述真实内核测试。
- helper 全套 library 测试 123 通过、1 个原有忽略项；新增锁释放、采样后会话复核、精确端点白名单测试。见 `traffic-helper-tests.log`。
- 界面定向回归 27 通过（流量 9、NetworkWorkspace 18）；流量包含采样周期、内存独立失败、后台偏好、无用内存关闭、旧代次、停用/卸载、图表时间定位与 gap、rAF 不触发 React 每帧 commit、减少动态效果。最终流量算法再次运行 9 项通过。
- Chromium 使用修改前/后的实际组件与隔离 IPC 合成夹具，分别模拟实测源码定义的 1 秒/2 秒首帧等待；测量刷新周期、帧间隔、SVG 更新与 React commit，检查 60 点上限、窄窗口、减少动态效果、后台和卸载无新请求。结果与截图见 `traffic-browser-performance.json`、`traffic-browser-comparison.png`、`traffic-browser-narrow.png`。该浏览器测试不冒充 WKWebView 或真实账号流量验收。
- 全量 UI 首轮 2900/2910 通过；4 个文件的 10 个失败包含 8 项超时、一个 App 状态断言、一个图标异步查找失败。另行按单 worker 复核，结果补记下方。全量格式检查有 5 个本轮范围外文件问题，未为本次优化改写这些文件。

完整提案、Intel 真机、受管服务 revision 11 的真实 TUN/安装升级验收仍不据此标记通过。当前产物为 Apple Silicon 内部 ad-hoc 构建，未公证。

## 最终复核与交付

- 原生网络首轮 59/60 通过；唯一失败为此前已有真实端口/DNS应用恢复集成测试，单独复核 1/1 通过（`traffic-network-recovery-rerun.log`，19.99 秒）。保留首次失败记录；没有把它删除或改成忽略，也没有修改恢复逻辑。首轮与大规模前端测试同时运行，负载/时序影响是推测，不据此认定根因。
- 全量 UI 首轮失败的 4 个文件使用单 worker 复核，133/133 全部通过（`traffic-ui-failed-files-rerun.log`）。没有为通过测试更改图标、供应商或应用管理逻辑。
- 最终流量组件测试 9/9、TypeScript 类型检查与本轮 5 个 TS/TSX 文件格式检查通过，OpenSpec strict 通过。全量格式的 5 个范围外文件问题保留。
- 最终浏览器对比：原组件请求均值 3001.6ms，新组件 1052.3ms；约10秒观察窗 SVG 更新 3 → 484 次，新组件 React 仅 23 次 commit（没有按动画帧重渲染）；帧间隔 P95 17.6ms、最大 49.9ms，SVG属性写入 P95 0.1ms。后者仅属性写入成本，不能解释为整帧绘制时间。减少动态效果后1300ms仅 2 次数据更新，后台和卸载后新增请求均为0。
- 临时基准页与旧组件已从 `app/src` 移除，夹具和运行脚本保存在 `build/reports/traffic-benchmark-fixture`；生产打包不含这些文件。

- Apple Silicon `dist/internal-aarch64/Sivio.app` 与内部 ZIP、更新 tar.gz 已生成。严格深度 ad-hoc 签名、ZIP/TAR 完整性、包内主程序及全部内置可执行文件架构、13 个关键源文件与包内对应源码逐项摘要、最终文案与旧停止保存限制去除检查均通过。服务 revision 11 源码及打包资源一致，开发夹具不进入包。见 `build/reports/traffic-packages-verified.json`。
- ZIP SHA-256：`8ae3ca5b97bfe1248aced732d2f93e348f6e0266b5eabd992ab3a6875aff5d14`。新版未公证；未安装或替换本机正在使用的 App/服务。
