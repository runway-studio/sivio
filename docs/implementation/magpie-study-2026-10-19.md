# Magpie 源码学习：模型选择与路由

研究日期：2026-10-19。上游：[yetone/magpie](https://github.com/yetone/magpie)。
读取版本：`9b72add51dea589f95cf75c86cf51c3e9aff63e6`，提交时间 2026-10-19 18:02:56 +08:00。

本文为源码研究记录和后续建议，不代表功能已实现。阅读了实现、相关回归测试与子系统文档；未运行 Magpie、安装依赖或执行其测试，未修改用户真实配置。

## 1. 产品与架构

Magpie 将 Agent 配置管理、模型目录和本地网关放在同一个产品里。默认网关为 `127.0.0.1:3425`，处理 OpenAI Chat/Responses、Anthropic Messages 和 Gemini 协议；上游与客户端协议不一致时转换。

- `internal/agent`：各客户端的配置读写、接管、恢复、外部修改检测与同步。
- `internal/provider`：供应商、模型目录、账号与路由组。
- `internal/gateway`：协议适配、候选选择、失败切换、会话绑定与请求轨迹。
- `internal/routes`：候选排序策略；故障恢复和会话绑定仍由网关负责。
- `internal/edit`：保留格式的配置编辑与写盘。
- `internal/gui`：Wails v3 桌面窗口与托盘面板，内嵌网页通过 JSON API 调用后端；浏览器模式复用同一页面。另有 CLI/TUI。

来源：[网关](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/docs/subsystems/gateway-routing.md)、[GUI](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/docs/subsystems/gui-shell.md)、[策略接口](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/routes/routes.go)。

## 2. 对当前模型问题最有价值的设计

### 模型身份、显示名称、路由组分开

目录模型以 `provider/model` 引用，组以 `group/<id>` 引用；名称与标签另存。选择器先展示路由组，再按供应商展示具体模型。网关也接受部分简写，因此并非所有输入都强制带前缀。

组成员既可以是模型，也可以是另一组；保存时拒绝循环引用。组不是某个 Claude 角色的伪装名称，而是独立对象。这样可以清楚表示“我选了固定模型”与“我选了一组候选”。

来源：[选择器](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/agent/route.go)、[路由组](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/provider/group.go)、[未知模型说明](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/gateway/unknown_model.go)。

### 主模型保存与 Claude Code 内的选择保持一致

Magpie 接管时将主模型写入 `settings.json.model`，移除该文件中的 `env.ANTHROPIC_MODEL`，并在退出接管时恢复原先拥有的配置。`Follow` 跟踪 Claude Code 内 `/model` 保存的选择，更新需要跟随的角色。

Claude 官方文档明确说明：会话内 `/model` 优先级最高；启动时 `--model` 高于 `ANTHROPIC_MODEL`，后者又高于 settings 的 `model`。因此两个持久化字段冲突时，当前会话可以切成功，新会话却可能回到环境变量指定的模型。

来源：[实现](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/agent/claude.go)、[切换测试](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/agent/claude_pick_test.go)、[官方优先级文档](https://code.claude.com/docs/en/model-config#setting-your-model)。

### “跟随主模型”必须表达意图

角色或子代理可以跟随主模型，也可以固定选一个模型。即使固定选择恰好等于当前主模型，也不能据此判定为跟随。Magpie 有专门回归测试：角色固定为 A，主模型从 A 改到 B 后，该角色仍须使用 A；用户明确选回“跟随”后才联动。

来源：[固定与跟随测试](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/agent/claude_tier_pick_test.go)。

### 客户端列表必须包含当前选择

Magpie 曾遇到“路由组已设为当前模型，但 Claude Code 的模型列表里没有它”。其回归测试验证路由组出现在 `modelPicker`，并在新增组后同步列表。

来源：[路由组列表测试](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/agent/claude_picker_group_test.go)。

## 3. 配置管理与路由可解释性

配置管理区分接管前的值、上次写入的值、当前真实配置。`stash.json` 用于恢复，`applied.json` 用于识别偏离；断开预览在临时环境执行实际断开逻辑，再比较文件，避免预览和执行使用不同规则。

编辑器只修改指定字段，尽量保留注释和格式；普通文件通过临时文件、同步、重命名写入。软链接保留链接、修改目标；硬链接使用原位写入，源码明确说明该分支不具备普通重命名写入的原子性，不能概括为“所有写入都原子”。

来源：[接管文档](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/docs/subsystems/agent-wiring.md)、[写盘实现](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/edit/file.go)。

路由轨迹在实际决策点记录，而非事后推测：请求模型、命中组与规则、候选顺序、会话绑定、每次尝试、耗时与响应报告的模型分别保存。这里的“响应报告模型”是上游声明，不是对实际部署模型的独立认证。

来源：[轨迹结构与实现](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/internal/gateway/trace.go)。

## 4. 对 Sivio 的具体启发

| 优先级 | 建议 | 对应用户问题 |
| --- | --- | --- |
| P0 | 补验 `ANTHROPIC_MODEL` 与 `model` 冲突时，切换路由、`/model`、重启的完整行为 | 防止“当时选对了，重启又变了” |
| P0 | 配置页同时呈现主模型、各角色/子代理目标、固定或跟随状态 | 防止配置含义与用户理解不同 |
| P1 | 将客户端请求模型、映射目标、最终供应商、响应报告模型串成一条可查看记录 | 直接解释“为什么最终用的是它” |
| P1 | 为模型选择器、配置投影和请求映射建立共享的身份/解析规则 | 减少显示、保存、转发三处各自解释模型名称 |
| P1 | 以用户操作序列补充回归，而不只测试单个映射函数 | 覆盖切换、编辑、外部修改、重启及退出接管 |
| P2 | 评估独立路由组和会话绑定策略 | 在多供应商选择与缓存保持之间建立明确语义 |

当前已有 `live/project` 配置投影、`mode` 控制器、`proxy/model_mapper`，适合在这些边界上改进；无需为学习 Magpie 而更换 Tauri/Rust/React 技术栈。

**对上一轮修复的补充判断：** `claude-route-model-fixes.md` 记录了保留 `ANTHROPIC_MODEL` 和供应商已保存 `model` 的修复。这解决了原先直接删除默认模型的问题，但尚不能证明 `/model` 保存的新选择在重启后仍然生效。当前源码保留两个字段，结合官方优先级可以确定存在冲突条件；用户机器上的实际重现及最终修复策略仍需验证。不能简单重新删除环境变量，必须先确定主模型值、配置归属、退出恢复以及代理兜底各自如何处理。

建议验收场景：默认 A → 直连转路由仍为 A；`/model` 改为 B → 新会话按约定使用 B；固定角色 A 不随主模型 B 改变；跟随角色更新为 B；切换供应商、修改真实配置、退出路由各自遵守恢复约定；当前所选目标始终可在选择器找到。

## 5. 借鉴范围

Magpie 的 Claude 订阅转接通过本机 Claude Code 进程及 MCP 桥接完成，涉及进程、会话、工具调用恢复；它是另一套集成，不应当作普通 API Key 路由的替代实现直接搬入。

来源：[Claude 订阅桥接](https://github.com/yetone/magpie/blob/9b72add51dea589f95cf75c86cf51c3e9aff63e6/docs/subsystems/claude-subscription-bridge.md)。

本轮最值得吸收的是模型身份、用户选择意图和可解释的配置生命周期。独立路由组等新能力可在需要实施时另行设计；本文没有修改业务代码或重新打包 App。
