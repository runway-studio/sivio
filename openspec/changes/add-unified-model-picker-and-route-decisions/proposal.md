# Change: 统一模型选择与路由决策记录

## Why
用户已明确批准先实现统一模型选择器与路由决策记录，验收后重新打包。现有模型配置入口分散，用量记录不足以解释实际尝试和故障切换。

## What Changes
- 首页和客户端页共用模型选择器，按客户端、供应商搜索已配置模型，允许明确输入自定义模型；覆盖已有完整路由链路的 Claude Code、Codex、Gemini CLI、Grok Build。
- 保留当前运行模式，通过现有配置写入和恢复机制切换供应商与模型。Claude 路由选择延续设备级隔离，避免覆盖直连默认。
- 持久化有界的路由决策元数据，展示请求模型、候选顺序、每次实际尝试、出站模型、HTTP 结果和耗时；不保存请求正文或认证材料。
- 最近路由记录可按客户端筛选、刷新、查看详情；直接访问供应商的流量不伪造记录。

## Impact
- Affected specs: model-routing
- Affected code: mode、provider service、proxy forwarder、首页、客户端页、新增选择器与决策面板
- 延续 Tauri/Rust/React，实现后运行隔离配置、真实本机 HTTP、前端及打包验证。
