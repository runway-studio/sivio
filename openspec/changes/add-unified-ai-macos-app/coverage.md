# 功能覆盖矩阵

每一行是必须交付的用户能力，不是可选清单。各行成功/失败验收全文在对应 spec 的同 ID Requirement 下。阶段用于排期，不减少最终范围；任务完成须链接测试报告或真机证据。来源代号见 sources.md。

| ID | 能力 | 规范 | 任务 | 阶段 | 来源 |
| --- | --- | --- | --- | --- | --- |
| F01 | 统一应用与导航 | [desktop-shell](specs/desktop-shell/spec.md) | T05 | M1 | CC/CV |
| F02 | 窗口托盘与快捷键 | [desktop-shell](specs/desktop-shell/spec.md) | T05 | M1 | CC-SET/CV |
| F03 | 外观语言和编辑体验 | [desktop-shell](specs/desktop-shell/spec.md) | T25 | M3 | CC-SET/CV |
| F04 | 更新关于与诊断入口 | [desktop-shell](specs/desktop-shell/spec.md) | T25 | M3 | CC-SET/CV |
| F05 | 供应商配置全流程 | [ai-tools](specs/ai-tools/spec.md) | T08 | M1 | CC |
| F06 | 十种客户端与能力边界 | [ai-tools](specs/ai-tools/spec.md) | T19 | M3 | CC |
| F07 | 客户端发现安装升级和终端 | [ai-tools](specs/ai-tools/spec.md) | T19 | M3 | CC-SET |
| F08 | MCP 统一管理 | [ai-tools](specs/ai-tools/spec.md) | T17 | M2 | CC |
| F09 | Skills 发现安装同步更新 | [ai-tools](specs/ai-tools/spec.md) | T17 | M2 | CC |
| F10 | 提示词和专属工作区 | [ai-tools](specs/ai-tools/spec.md) | T18 | M2 | CC/CC-WS |
| F11 | 项目配置切换 | [ai-tools](specs/ai-tools/spec.md) | T20 | M3 | CC |
| F12 | 会话浏览检索恢复和导出 | [ai-tools](specs/ai-tools/spec.md) | T21 | M3 | CC |
| F13 | 用量成本余额和额度 | [ai-tools](specs/ai-tools/spec.md) | T22 | M3 | CC |
| F14 | 授权中心与多账号 | [ai-tools](specs/ai-tools/spec.md) | T23 | M3 | CC-SET |
| F15 | 工具专属增强和环境诊断 | [ai-tools](specs/ai-tools/spec.md) | T20 | M3 | CC-SET/CC |
| F16 | 直连路由聚合模式 | [ai-routing](specs/ai-routing/spec.md) | T11 | M2 | CC |
| F17 | 协议转换与流式请求 | [ai-routing](specs/ai-routing/spec.md) | T11 | M2 | CC |
| F18 | 故障转移健康与连通探测 | [ai-routing](specs/ai-routing/spec.md) | T12 | M2 | CC/CC-TEST |
| F19 | 订阅和配置档案 | [network-proxy](specs/network-proxy/spec.md) | T09 | M1 | CV/CV-UI |
| F20 | 配置增强及规则节点编辑 | [network-proxy](specs/network-proxy/spec.md) | T13 | M2 | CV |
| F21 | 节点代理组测速与链式代理 | [network-proxy](specs/network-proxy/spec.md) | T14 | M2 | CV/CV-UI |
| F22 | 系统代理PAC和守卫 | [network-proxy](specs/network-proxy/spec.md) | T15 | M2 | CV/CV-UI |
| F23 | TUN权限服务与修复 | [network-proxy](specs/network-proxy/spec.md) | T16 | M2 | CV-SVC |
| F24 | DNS端口LAN和高级网络设置 | [network-proxy](specs/network-proxy/spec.md) | T16 | M2 | CV/CV-UI |
| F25 | 连接流量日志与规则观察 | [network-proxy](specs/network-proxy/spec.md) | T14 | M2 | CV/CV-UI |
| F26 | 内核版本启停与升级 | [network-proxy](specs/network-proxy/spec.md) | T10 | M1 | CV |
| F27 | 网络和媒体可用性检测 | [network-proxy](specs/network-proxy/spec.md) | T24 | M3 | CV-UI |
| F28 | 两项目迁移与格式兼容 | [data-lifecycle](specs/data-lifecycle/spec.md) | T07 | M1 | CC-SET/CV-UI |
| F29 | 本地备份恢复和清理 | [data-lifecycle](specs/data-lifecycle/spec.md) | T06 | M1 | CC-SET/CV-UI |
| F30 | WebDAV和S3同步 | [data-lifecycle](specs/data-lifecycle/spec.md) | T24 | M3 | CC-SET/CV |
| F31 | 密钥与导出隐私 | [data-lifecycle](specs/data-lifecycle/spec.md) | T06 | M1 | 本项目设计 |
| F32 | AI与网络出口协作 | [integration-runtime](specs/integration-runtime/spec.md) | T04 | M0 | 本项目设计 |
| F33 | 外部配置并发与事务恢复 | [integration-runtime](specs/integration-runtime/spec.md) | T06 | M1 | CC/CV |
| F34 | 退出崩溃与睡眠恢复 | [integration-runtime](specs/integration-runtime/spec.md) | T18 | M2 | CC/CV |
| F35 | 不可信输入与系统边界 | [integration-runtime](specs/integration-runtime/spec.md) | T13 | M2 | 本项目设计 |
| F36 | 安装升级卸载及验收平台 | [integration-runtime](specs/integration-runtime/spec.md) | T28 | M4 | SIGN/本项目设计 |

## 客户端支持表

S=互斥切换，A=共存；“—”是上游不支持，不能改标为延期。客户端实际配置格式和重启差异应以固定源码适配器为准。

| 客户端 | 供应商 | AI路由 | 聚合 | MCP/Skills | 提示词/工作区 | 会话 | 用量 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | S | 是 | 是 | 是/是 | CLAUDE.md | 浏览/恢复 | 是 |
| Claude Desktop | S | 模型映射时 | — | —/— | — | — | 模型映射时 |
| Codex | S | 是 | 是 | 是/是 | AGENTS.md | 浏览/恢复 | 是 |
| Gemini CLI | S | 是 | — | 是/是 | GEMINI.md | 浏览/恢复 | 是 |
| Grok Build | S | 是 | — | 是/是 | AGENTS.md | 浏览/恢复 | 是 |
| OpenCode | A | — | — | 是/是 | AGENTS.md | 浏览/恢复 | 是 |
| OpenClaw | A | — | — | —/— | 工作区及记忆 | 浏览 | — |
| Hermes | A | — | — | 是/是 | 记忆 | 浏览，最近500条 | — |
| Pi | A | — | — | 是/是 | AGENTS/SYSTEM/APPEND/模板 | 浏览/恢复 | 是 |
| MiniMax Code | A | — | — | 是/是 | AGENTS.md | 浏览/恢复 | 是 |

托盘供应商切换覆盖前五种互斥工具；通用供应商同步覆盖 Claude Code/Codex/Gemini。Claude Desktop 中通向 Claude Code 扩展面板的入口必须标注实际作用目标，不能暗示对 Desktop 原生支持。

官方身份、聚合和协议方向限制保持基线行为；聚合不承诺故障转移。连通测试不得作为鉴权或模型成功的依据。对不支持的客户端版本显示明确原因，不能输出会破坏文件的通用 JSON。

## 交付台账规则

coverage.json 为可检查索引；与本表、spec 标题和 tasks.md 同步。每行后续追加 implemented commit、fixture report、live report 或不适用证据。外部账号不可用可以阻止对应 live 验收，不得把 fixture 成功写成全功能验证成功。所有行完成才允许关闭本 change。

## F15专属配置验收展开
- OpenClaw：导入/列出/读取live供应商、配置健康扫描、默认模型、模型目录、agents defaults、env和tools读写。
- Hermes：live供应商导入/读取、模型配置、记忆读写/限制/启停、打开Web UI和启动dashboard；外部UI在默认浏览器打开，不赋予Tauri权限。
- OpenCode OMO/OMO Slim：读取本地配置、识别当前供应商、禁用当前配置；保留相应供应商配置接入。
- Claude：插件状态/读取/应用/是否生效、初始化跳过开关及撤销。环境诊断支持冲突检测、选择性删除、备份恢复。
- Pi：按F10实现其独有提示词/模板，按适配器保持共存供应商和客户端文件格式；不臆造Pi专属公共命令。

以上来自固定基线commands模块的实际函数清单；T01把更细的UI子操作映射到这些能力，不以“高级设置”一词代替验收。
