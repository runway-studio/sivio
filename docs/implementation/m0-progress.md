# M0 执行记录

用户已授权执行 `add-unified-ai-macos-app`，完成后打包 `.app`。本次已解除磁盘/工具链阻塞，产出了可运行的 **M0 工程验证包**，完整集成和 M0 总门槛仍未完成。用户已确认暂时没有 Intel Mac，Intel 真机验收保留未通过。

## 本次实际产物

- `experiments/m0-host/`：单 Tauri Builder、独立 bundle ID `local.siassist.desktop`，供应商兼容、网络 YAML 与真实 Mihomo 校验探针。供应商结构来自 CC 固定提交，URL 规范化和 YAML 检查路径来自 CV 固定提交；适配范围和许可证见该实验 README。
- `experiments/m0-path/`：独立 Rust 请求路由样条，本机测试 client → route → 真正的 Mihomo → 本机 mock upstream。没有调用外部 AI 服务。
- `native/helper/`：独立 helper 源码副本，原上游保留。一次身份隔离补丁改动 service ID、bundle ID、socket 和 state slug，并将旧 Clash helper 清理函数置为空操作；已编译 helper / 安装器 / 卸载器。
- `dist/m0-arm64/SI Assist M0.app` 和 `.zip`：Apple Silicon 工程验证包，含 Logo、固定 Mihomo、来源许可，ad-hoc 签名。未公证，未作为全功能版本交付。
- `scripts/build-m0.py`：可复现 arm64 实验构建；固定 Cargo / pnpm lock、Rust 1.99.0、Node 24.21.0、pnpm 10.13.1、Tauri 2.12.1。

## 已获得的执行证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 工具链与 SDK | 通过，默认 Rust 仍为 1.84.1，实验使用独立 1.99.0 | build/reports/build-preflight.json |
| arm64 供应商 / YAML 兼容测试 | 2 项通过 | build/reports/m0-cargo-test.log |
| x86_64 宿主交叉编译 | 通过，未运行 Intel 真机 | build/reports/m0-intel-build.log |
| 主程序最低系统 | arm64 / x86_64 Mach-O 均为 minos 12.0 | otool -l 实际检查 |
| helper 独立身份测试 | 1 项通过；standalone 三个二进制编译通过 | build/reports/helper-identity-test.log、helper-build.log |
| Mihomo 四种资产 | stable / Alpha × arm64 / Intel 下载大小和 SHA256 全部匹配固定清单 | build/cache/mihomo/**/verification.json |
| 非 TUN 请求通路 | 1 项集成测试通过，含 direct / managed / custom、流式首块、停止 core 后 502 且上游未收到回退请求 | build/reports/m0-path-test.log |
| 导出的应用 | deep / strict 签名校验通过，资源检查通过 | build/reports/m0-validation.json |
| 原生窗口 | 实际启动并点击校验按钮：供应商通过；YAML 经 Mihomo 通过；错误 YAML 显示失败 | 原生 accessibility 观察结果记入 m0-validation.json |

应用 ZIP SHA256：`5801c4877378246f8f66cab9635b51eb9deb9256a61a588cae803fafb4dfbaae`。

构建过程中修复了两个真实环境问题：用户 Cargo 的旧 git 镜像索引返回 502，在项目 `.cargo/config.toml` 改用同镜像 sparse；Homebrew 的 xattr 不支持 Tauri 使用的递归参数，在构建脚本中优先使用系统 xattr。未改用户全局 Cargo 配置或默认工具链。

## T01 范围审计

实际提取 434 个 IPC 入口，432 个已按命令所属领域映射到 F01–F36，2 个明确排除：Windows UWP 和上游性能测试注入。见 `build/reports/upstream-operation-map.json`。这是入口级分类，通用设置命令中的逐字段行为、手册和界面操作还未穷尽，因此 **T01 不勾选完成**。

三个上游来源的文件级 SHA256、源码树摘要、Cargo git 依赖和四个 Mihomo 固定资产见 `build/reports/upstream-manifest.json`。发布元数据中的摘要现已有对应本地下载验证，但 manifest 整体仍标记 partial，避免误称整个来源锁定任务已验收。

## M0 尚未通过的关键差异

T03 审计发现，独立 ID 和 socket 的移植修订不足以满足提案要求：

- 当前 helper 尚未实现本提案的主进程 5 秒续约、30 秒失联恢复与唤醒宽限协议。
- 上游网络清理不能直接被当成本 App 修改前快照的所有权恢复；仍需补齐状态快照、外部接管判断和崩溃恢复验证。
- 尚未完成调用方生产身份校验、管理员授权允许/拒绝、安装/修复/卸载及 TUN 防回环真机验证。当前没有安装任何 helper，也未修改系统代理或 TUN。
- T04 只验证非 TUN HTTP 样条；流取消传播、端口冲突、TUN 通路和模型协议适配未通过。当前简单 forwarder 不能替代生产 AI Router。
- Intel 真机与 macOS 12 真机暂缺；用户明确要求保留未通过状态。交叉编译不替代运行验收。

按提案的 M0 门槛，目前不放行大规模业务页面迁移，不将工程包冒充完整应用。下一步需要继续完成 T01 字段/操作台账、T03 的安全恢复实现和权限验证，再执行剩余 T04 场景；M1–M4 仍未开始。

28 项任务均保留未勾选；本轮有具体源码、构建、原生运行和网络通路证据，未宣称完整功能交付。
