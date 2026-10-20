## ADDED Requirements

### Requirement: F05 供应商配置全流程
系统 SHALL 提供 供应商配置全流程，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F05-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 每个受支持工具可添加预设/自定义供应商、编辑、复制、搜索、排序、导入导出、模型与端点选择，并查看生效配置预览

#### Scenario: F05-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 非法配置阻止应用；切换前后未知字段和注释保留；无权限时原文件 hash 不变

### Requirement: F06 十种客户端与能力边界
系统 SHALL 提供 十种客户端与能力边界，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F06-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 完成coverage.md 客户端表的所有支持组合；互斥工具切换、共存工具增删；显示重启要求；Claude Desktop 支持直连和模型映射

#### Scenario: F06-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 不支持的组合明确禁用；缺失客户端显示安装入口而非假成功；官方账号恢复不混用第三方 Key

### Requirement: F07 客户端发现安装升级和终端
系统 SHALL 提供 客户端发现安装升级和终端，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F07-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 检测版本、路径、安装来源；逐个及批量安装升级；支持原 macOS 终端偏好与不可用时回退；路径有空格亦可启动

#### Scenario: F07-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 受管安装失败按快照恢复；不可回滚安装器失败标记需要修复并提供重装或修复入口，不宣称旧版必然保留；未知来源不覆盖，参数不能注入 shell

### Requirement: F08 MCP 统一管理
系统 SHALL 提供 MCP 统一管理，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F08-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 添加编辑删除、模板导入、已有配置导入、搜索、按工具及批量启停，正确同步支持的客户端格式

#### Scenario: F08-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 部分目标不可写时逐项报告并恢复该目标；禁用只删除本 App 管理且未被外部改写的字段

### Requirement: F09 Skills 发现安装同步更新
系统 SHALL 提供 Skills 发现安装同步更新，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F09-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 从 skills.sh/GitHub/ZIP 发现安装、检查及批量更新，支持通用目录、软链接/复制/自动策略，卸载可恢复备份

#### Scenario: F09-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** ZIP 路径穿越和逃逸软链接被拒绝；已有同名用户文件不静默覆盖；网络失败保留旧版本

### Requirement: F10 提示词和专属工作区
系统 SHALL 提供 提示词和专属工作区，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F10-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 维护每个支持客户端提示词库与启用文件；Pi 模板和系统提示词、OpenClaw 九种工作区文件及每日记忆、Hermes 记忆能搜索编辑保存

#### Scenario: F10-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 启用前保存原内容；日期与路径校验；编辑期间外部改动产生冲突，不直接覆盖

### Requirement: F11 项目配置切换
系统 SHALL 提供 项目配置切换，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F11-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** Claude Code/Codex 保存和切换供应商、MCP、Skills、提示词快照，Claude Desktop 保存供应商；切走前保存当前项目状态

#### Scenario: F11-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 任一步应用失败保留旧活动项目和恢复记录，不显示整个项目切换成功

### Requirement: F12 会话浏览检索恢复和导出
系统 SHALL 提供 会话浏览检索恢复和导出，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F12-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 按基线支持范围浏览、项目时间分组、全文搜索、结构化阅读、复制、Markdown 导出、删除及终端恢复

#### Scenario: F12-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 损坏记录跳过并提示；OpenClaw/Hermes 不提供不受支持的恢复；删除前确认并明确不可恢复性

### Requirement: F13 用量成本余额和额度
系统 SHALL 提供 用量成本余额和额度，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F13-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 解析本地会话与路由记录，按工具/供应商/模型统计请求Token缓存速度成本，支持趋势热力图、自定义定价和额度倒计时/脚本

#### Scenario: F13-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 未知价格显示未知而非0；同一请求不重复计费；脚本失败显示时间和原因且不影响正常路由

### Requirement: F14 授权中心与多账号
系统 SHALL 提供 授权中心与多账号，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F14-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 按上游支持范围提供 Copilot/ChatGPT/xAI 登录、刷新、默认账号和退出，账号与供应商绑定；实验接入首次使用展示明确说明

#### Scenario: F14-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 取消/过期/拒绝授权无残留生效配置；退出清理本地凭据；不将第三方账号 token 发给其他供应商

### Requirement: F15 工具专属增强和环境诊断
系统 SHALL 提供 工具专属增强和环境诊断，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F15-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 覆盖配置目录覆盖、环境冲突检测处理、Claude 插件同步与初始化选项、Codex 登录保留/历史迁移，以及上游 OpenClaw/Hermes/Pi/OMO 专属配置入口

#### Scenario: F15-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 迁移前备份并支持恢复；不支持的版本拒绝写入并说明；不清空无关环境变量
