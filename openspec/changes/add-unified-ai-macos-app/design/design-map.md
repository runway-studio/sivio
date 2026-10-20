# SI Assist · macOS 设计稿 v0.3

> 2026-10-16 导航修订：最新三栏方案见 [v0.4 交互原型](navigation-v3/index.html) 和 [交互说明与实施拆分](navigation-v3/interaction-design.md)。本页以下保留原 v0.3 页面与配色资料；导航以 v0.4 为准。本轮未修改正式 App。

日期：2026-10-15。状态：可评审的高保真交互原型，未进入产品实现。

## 本轮配色修订

按用户指定的 ai-token-desktop 配色重做全部 11 个页面：白色背景、冷灰卡片、近黑文字、紫色操作/选中，绿色保留为健康状态；同步调整弹窗、图表、深色及紧凑窗口。10 张预览图全部重新生成。参考截图归档于 [references/itokens-color-reference.png](references/itokens-color-reference.png)，具体色值与映射见 [design-system.md](design-system.md)。

## 打开方式

直接用浏览器打开 [index.html](index.html)。无需安装依赖或联网；HTML、CSS、JS 都在本目录。可点击左侧导航，按 ⌘K 打开页面搜索，左下角月亮按钮切换深浅色。

这是设计资产，不是可运行的macOS产品：没有Tauri、文件读写、系统授权、真实AI调用或网络代理。所有指标、地址、会话、账号、服务状态均为示例；输入仅在页面内存中使用，刷新重置，不应填真实密钥。

## 文件与资产

| 文件 | 用途 |
| --- | --- |
| [index.html](index.html) | 设计稿入口、窗口和导航结构 |
| [styles.css](styles.css) | 语义颜色、布局、控件、深色与紧凑适配 |
| [prototype.js](prototype.js) | 示例页面、导航和核心交互状态 |
| [design-system.md](design-system.md) | 视觉规范与组件规则 |
| [interaction-spec.md](interaction-spec.md) | 关键流程、失败反馈、原型边界 |
| [validation.json](validation.json) | 本轮浏览器检查记录 |
| [previews/01-overview-light.png](previews/01-overview-light.png) | 浅色概览 |
| [previews/02-ai-tools.png](previews/02-ai-tools.png) | AI供应商管理 |
| [previews/03-network.png](previews/03-network.png) | 网络代理与独立出站策略 |
| [previews/04-sessions.png](previews/04-sessions.png) | 会话阅读 |
| [previews/05-usage.png](previews/05-usage.png) | 用量与成本 |
| [previews/06-import-preview.png](previews/06-import-preview.png) | 迁移预览 |
| [previews/07-tun-permission.png](previews/07-tun-permission.png) | TUN授权说明 |
| [previews/08-config-conflict.png](previews/08-config-conflict.png) | 外部配置冲突 |
| [previews/09-overview-dark.png](previews/09-overview-dark.png) | 深色概览 |
| [previews/10-compact-layout.png](previews/10-compact-layout.png) | 1024px紧凑窗口 |

设计资产为本轮原创HTML/CSS/SVG与本地浏览器截图，没有Figma来源。SI图标使用已确认的「汇流」SVG 标志，工具卡片使用字母缩写占位，不声称是各产品官方logo。字体使用macOS系统字体，不加载第三方字体或脚本。

## Logo 交付

已将确认的「汇流」Logo 替换到侧栏与浏览器图标，展示页也切换到矢量母版。见 [Logo 展示页](logo/index.html) 与 [资产目录和使用说明](logo/README.md)：包含纯路径 SVG、应用图标 SVG、透明 PNG、macOS ICNS、10 个标准尺寸的 iconset、Xcode AppIcon.appiconset 与可复现导出脚本。原始生成概念 PNG 保留作参考。10 张界面预览同步重新生成。

## 页面与需求映射

| 页面 | 已表现内容 | 对应需求 | 深度 |
| --- | --- | --- | --- |
| 概览 | 用量概况、网络连接示意、常用工具、最近动态、接入入口 | F01/F13/F28/F32 | 高保真页面，可跳转核心流程 |
| AI工具 | 工具选择、能力相关模式、供应商列表/搜索/新增/切换预览/冲突 | F05/F06/F16/F18/F33 | 核心流程交互；客户端适配与真实模型列表为示例 |
| 项目 | 配置快照卡片与切换入口 | F11 | 结构稿，切换显示说明 |
| MCP服务 | 服务列表、启停、添加表单、同步目标 | F08 | 核心交互模拟 |
| Skills | 技能列表、启停、来源输入、同步目标 | F09 | 核心交互模拟；不含真实检索结果页 |
| 提示词 | 库列表、内容预览、编辑、启用入口 | F10 | 结构与编辑弹窗，复杂工作区待深化 |
| 会话历史 | 搜索、列表/详情、结构化阅读、恢复/导出入口 | F12 | 阅读交互，外部终端/导出只作说明 |
| 用量成本 | 指标、趋势、按工具统计、估算说明 | F13 | 高保真；日期切换是视觉状态，数据不重新计算 |
| 授权中心 | 账号卡片、实验提示、设备授权示意 | F14 | 核心流程示意，不发起OAuth |
| 网络代理 | 节点/订阅/规则/连接/日志，系统代理与TUN分离，AI出口独立 | F19–F26/F32 | 核心交互；高级编辑为简化表单 |
| 设置 | 通用、AI、网络、数据同步、关于；主题、导入、备份、同步入口 | F02–F04/F15/F28–F31 | 核心结构；部分偏好只在当前DOM中模拟 |

本轮不是36项能力的逐操作终稿。F07批量升级、F15全部工具专属选项、F20完整规则编辑器、F21代理链构建、F27媒体检测、F34菜单栏与崩溃恢复、F36安装卸载界面尚未逐屏展开。它们仍属于原提案实施范围，不因没有完整设计画板被删除；后续对应任务开始前深化。

## 设计检查

使用ui-ux-pro-max的方法完成结构、可访问性、状态和一致性检查。自动生成的单栏落地页/新拟态推荐不适合桌面管理工具，因此采用桌面侧栏、实色边框与系统字体，不照搬模板。

已执行35项浏览器断言，包含11个页面渲染、桌面溢出、表单错误、新增、配置冲突、能力限制、TUN拒绝/允许、深色切换和紧凑窗口；无JS运行错误，未发起外部请求。手工查看概览、网络和深色截图。

仍需正式实现时验证：VoiceOver完整阅读顺序、真实系统字号放大、真实屏幕色彩、所有异步/加载状态及每个任务的业务验收。原提案的93分是规划审查结果，不等于本设计或未来产品已通过全部验收。
