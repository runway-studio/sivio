# ChatGPT 资源域名分流修复

## 当前配置

用户授权后，在运行中的 Sivio 全局规则增强前置加入：

```yaml
prepend:
  - DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI 服务
  - DOMAIN-SUFFIX,oaistatsig.com,🤖 AI 服务
append: []
delete: []
```

通过 App 保存并应用，规则列表已显示两条新规则。节点页确认并保存 `🤖 AI 服务 → ⚡️ 代理`，代理组选用 `x1.0 香港 - 中转4`。其余默认组仍按原设置，企业直连规则保留。

## App 默认行为

内置兼容增强默认开启。组装订阅时，按已有 ChatGPT、静态资源或 OpenAI 策略找到实际存在的组/节点，为两条缺失的域名规则补全策略。补全发生在最终 MATCH/FINAL 之前、全局和订阅自定义增强之前，因此支持自定义 prepend、delete、Merge 和脚本；原有同域名规则、明确的 ChatGPT DIRECT/REJECT 策略不被覆盖。

缺少可识别的已有策略时不猜测组名；本次订阅使用 `🤖 AI 服务`，其他订阅可以使用不同组名。内置规则随配置组装生成，更新订阅不会丢失，无需修改远程订阅。用户自定义添加的同一规则仍可能重复出现，但首条命中且不改变路由。

## 访问复测

通过当前运行 App 的 `127.0.0.1:7890` 显式 HTTP 代理，保持原香港中转4，连续三轮无登录、无 Cookie 请求：

| 目标 | 三次总耗时（秒） | 结果 |
| --- | --- | --- |
| Google generate_204 | 2.93 / 0.73 / 0.83 | HTTP 204 |
| ChatGPT 首页 | 1.58 / 1.66 / 0.85 | HTTP 403，未通过站点访问挑战 |
| ChatGPT trace | 2.32 / 0.84 / 0.92 | HTTP 200 |
| files.oaiusercontent.com 根路径 | 1.16 / 0.89 / 0.98 | TLS 成功，HTTP 404 |
| ab.chatgpt.com | 1.01 / 1.01 / 1.37 | HTTP 403 |

修复前文件域名三次 TLS 失败；修复后三次均完成 TLS 并收到响应。根路径 404 只代表服务器可达，不能代表实际文件上传/下载成功；403 不能当作登录后的 ChatGPT 页面、WebSocket 或模型回答速度。`ab.chatgpt.com` 属于原先已有的 chatgpt.com 规则，不是 oaistatsig.com 专用测速。

本地原始记录位于 `build/reports/chatgpt-network/after-rules.json`、`applied-settings.json`。官方域名清单依据：<https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps>。

## 回归验证

`cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib network::`：85 通过，0 失败，3 个真实内核/本地环境专项用例按原标记忽略。本次新增 5 个默认规则测试，覆盖补全顺序、幂等、既有策略、未知/直连目标、OpenAI 关键词策略、关闭开关和自定义删除/前置优先级。日志：`build/reports/chatgpt-network/default-rules-tests.log`。
