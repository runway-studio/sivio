# CC Switch 与 Clash Verge Rev 学习笔记

学习日期：2026-10-15。范围：README、依赖清单、关键源码静态阅读；未启动应用或执行测试，不等同于完整代码审计。当前 si-assist-desktop 目录为空，以下建议是后续设计参考，尚不是已确定需求。

CC Switch 阅读基线：`51ac86f1c59abfefabadebd05ec5a5415b8ad72c`，package.json 标记 4.0.12。Clash Verge Rev 阅读远程 main 文件，package.json 标记 2.5.8，未取得固定提交；主分支版本不等于最新稳定发行版。

## 1. 两个项目分别解决什么问题

| 维度 | CC Switch | Clash Verge Rev |
| --- | --- | --- |
| 产品核心 | AI 工具供应商切换及 MCP、Skills、Prompts 管理 | 代理订阅、配置、节点与内核运行管理 |
| 桌面技术 | Tauri 2、Rust、React、TypeScript、Vite | Tauri 2、Rust、React、TypeScript、Vite |
| 前端主要选型 | Radix UI、Tailwind、TanStack Query、CodeMirror | MUI、Emotion、SWR、Monaco |
| 重要状态 | 配置库、各工具 live 文件、设备模式状态 | 应用设置、订阅配置、合成后的运行配置、内核运行状态 |
| 学习重点 | 多工具适配、配置同步、冲突处理与恢复 | 进程和服务生命周期、配置合成、桌面系统集成 |
| 仓库声明许可 | MIT | GPL-3.0-only |

来源：[CC Switch](https://github.com/farion1231/cc-switch)、[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)、[Clash 前端依赖](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/package.json)。许可仅记录仓库声明。

## 2. CC Switch：最有参考价值的是配置管理边界

关键调用关系可概括为：React 页面 → 前端 API 封装 → Tauri command → ProviderService → 数据库及各客户端配置适配代码。

- `src/lib/api/providers.ts` 集中封装 invoke，并声明编辑器与切换结果类型。
- `src-tauri/src/commands/provider.rs` 处理 IPC 参数与状态获取，调用服务；部分文件操作使用 spawn_blocking。
- `src-tauri/src/services/provider/` 按 Claude、Codex、Gemini 等拆分编辑和直连逻辑，工具差异没有全部塞入 UI。
- `src-tauri/src/database/` 用 SQLite 保存供应商、MCP、提示词、Skills 等数据，含 schema 迁移、DAO 和备份模块。

几个值得保留的设计细节：

1. **配置库不等于客户端实际配置。** 数据库保存可选配置；live 文件是客户端当前使用的内容；设备模式另外管理。这对同时管理多个 CLI 的产品尤其关键。
2. **编辑过程考虑外部修改。** ProviderEditorSave 携带打开时的 base，并提供 refuse、keepMine、keepTheirs 冲突策略，避免编辑期间其他程序写文件后被无声覆盖。
3. **直连和代理模式显式建模。** mode/state.rs 区分 mode、attached、proxy_route、contract；切换路由与改写客户端文件是不同动作。
4. **写文件包含恢复设计。** config.rs 使用临时文件与替换机制；设备状态记录 pending 操作及文件前后 hash，为中断恢复提供依据。不能把单文件原子替换直接等同于多文件事务。
5. **记录写入所有权。** written、contract 等信息帮助识别本应用写入的内容；未知字段保留，减少破坏其他工具配置的可能。

源码入口：

- [前端 Provider API](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src/lib/api/providers.ts)
- [Provider commands](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/commands/provider.rs)
- [Provider service](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/services/provider/mod.rs)
- [SQLite 数据层](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/database/mod.rs)
- [设备模式状态](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/mode/state.rs)
- [文件写入](https://github.com/farion1231/cc-switch/blob/51ac86f1c59abfefabadebd05ec5a5415b8ad72c/src-tauri/src/config.rs)

## 3. Clash Verge Rev：最有参考价值的是运行管理

Rust 入口注册 commands 与桌面插件；core 下按 manager、service、runstate、sysopt、tray、updater 等职责组织模块。Mihomo 插件配置使用 LocalSocket 通信。

- **配置有合成过程。** enhance 模块处理订阅内容、merge、script、规则及代理组等输入，生成运行配置，并记录处理日志。
- **配置字段有管理权。** 应用管理的控制字段、TUN 和 DNS 字段有保护逻辑，覆盖写入可能被恢复并产生提示。这避免 UI 设置与脚本配置相互争夺同一字段。
- **运行结果是独立对象。** IRuntime 保存最终配置、出现过的键和链式处理日志，有利于解释“最终生效了什么”。
- **关闭窗口和退出程序分开。** 入口处理关闭时隐藏窗口、macOS 再次打开、轻量模式等情况；后台管理工具不能把组件卸载当成业务进程结束。
- **异常属于正常产品流程。** 入口存在初始化降级处理、macOS WebView 进程终止恢复钩子，以及服务修复、sidecar 继续运行等命令入口。具体恢复效果仍需运行验证。
- **工程脚本关注架构约束。** package.json 声明契约生成、IPC 架构检查、类型检查、单测和性能脚本；本轮未运行或验证这些脚本的覆盖范围。

源码入口：

- [应用入口与桌面生命周期](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/src/lib.rs)
- [Core 模块](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/src/core/mod.rs)
- [配置合成](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/src/enhance/mod.rs)
- [运行配置](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/src/config/runtime.rs)
- [Rust 依赖与插件](https://github.com/clash-verge-rev/clash-verge-rev/blob/main/src-tauri/Cargo.toml)

## 4. 对 si-assist-desktop 的建议（设计推论）

如果目标是管理本地 AI 工具或开发环境，可将 CC Switch 作为业务组织参考，将 Clash Verge Rev 作为常驻桌面应用参考：

1. 使用“界面 → 类型化 IPC → 业务服务 → 工具适配器/系统适配器”的边界，避免页面直接拼接和覆盖配置文件。
2. 分开建模用户想要的配置、生成的实际配置、当前运行状态。界面成功提示应依据实际应用结果。
3. 多工具适配优先定义读取、校验、预览、应用和恢复能力，再逐个实现客户端差异。
4. 从首版就考虑外部文件修改、失败恢复和日志；有后台进程时增加明确的启动、停止、失败状态。
5. UI 组件库按产品体验选择一套即可，不必同时引入两套项目的全部依赖。
6. Tauri + React + TypeScript + Rust 是可评估的候选方案；是否需要 SQLite、后台服务或高权限组件，应由真实功能决定。

本轮没有生成应用骨架，也没有把参考仓库代码复制进当前项目。源码下载遭遇磁盘空间不足，已删除本轮创建的临时克隆目录；结论来自已读取的源码和远程文件。
