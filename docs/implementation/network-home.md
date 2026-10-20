# 网络首页与概览工具图标

2026-10-19 用户明确要求补齐概览工具 Logo，并增加网络二级首页；在已批准完整 macOS 上游功能范围内实施。

## 固定源码依据与实现

对照 `vendor/upstream/clash-verge-rev/src/pages/home.tsx` 和 `src/components/home/`：profile、proxy、network、mode、traffic、test、ip、clashinfo、systeminfo 九类卡片；可选 info 是介绍/链接，不作为业务模块复制。

- 概览所有 10 个工具复用 AppGlyph 与本地品牌图标，Claude CLI/Desktop 保留区分角标。
- 网络二级首页置首；首次/非法导航记忆默认进入首页，合法旧页面记忆保持。布局和紫色主题沿用 Sivio 三栏样式。
- 当前订阅：选择、更新、更新日期、真实 subscription-userinfo 的用量进度/总量/到期日期；缺少数据用破折号。沿用现有跨订阅切换需先停止的约束，运行时禁用并说明；更新当前订阅沿用原有重应用事务。
- 当前节点：分组/节点选择、协议/UDP/最近延迟；PUT 带 expectedGeneration；不支持手选的分组禁用选择。
- 系统代理/TUN、规则/全局/直连：同一个 settings.save 版本校验/串行/回滚事务；保存期间锁定动作和跨域离开，不乐观伪造成功。
- 流量：复用平滑曲线和独立流量/内存采样，卸载停止轮询。
- 连通性：Apple、GitHub、Google、YouTube 及现有自定义检测，单项/最多四并发批量，显示真实 HTTP 状态；失败不报告可用，切代丢弃迟到响应。
- IP：Cloudflare speed meta，显式本机代理、10 秒超时、无重定向、32 KiB 响应上限、前后 generation 校验。默认掩码，不落盘，支持手动刷新。来源说明清楚表述为当前规则路由的出口。
- 内核与系统：真实版本、端口、规则数、运行状态、macOS/架构、Sivio 版本、服务授权/兼容状态、开机启动切换。
- 首页卡片选择仅存本地显示偏好，不存订阅地址/IP/凭据；隐藏卡片不发起对应查询。

## 验证与限制

本轮 UI 回归、原生边界、类型、生产构建、浏览器和包验证证据集中在 `build/reports/network-home-*`。只按实际完成结果记录，不把 synthetic IPC 截图算作真实 TUN/外部服务验收。已有 helper/TUN 权限机制未修改；不安装/替换用户正在运行的 App，不改真实网络设置。

### 本轮实际结果

- `network-home-regression.log`：5 文件、57 项通过（新增首页 6 项，原网络/导航/App 回归 51 项）。旧订阅测试显式进入订阅页，首次默认页断言更新为首页。
- `network-home-native.log`：新增 2 项通过，验证固定 HTTPS 目标集合和停机不直连。
- `network-home-typecheck.log`、`network-home-format.log`、`network-home-openspec.log`：通过。
- `network-home-renderer.log`：Vite 生产前端构建通过；保留既有大包体积提示。
- 浏览器实际视觉验证与新版 App 签名打包未执行：自动审批服务多次返回 `Selected model is at capacity`，明确为审批服务无法完成审核而非安全判定。临时截图 fixture 已移出 app/src，保留在 `build/reports/network-home-browser-fixture/`。未绕过审批，未将旧 dist App 当作本次交付。
- 本轮没有真实外网端点响应、真实 TUN 或已安装 App 的测试证据；原生边界测试与 UI synthetic IPC 不能替代这些。
