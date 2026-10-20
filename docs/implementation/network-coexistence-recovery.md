# 原版 Clash 与 SI Assist 并行运行修复

2026-10-16。用户反馈 system proxy recovery requires the SI Assist service；确认 revision 9 已安装但新版 App 未登记，用户已完成登记。随后确认 7890 被原版 Clash 的 /Library/Application Support/clash-verge-service/cores/verge-mihomo 占用；用户明确要求改 SI Assist 为 7891，原版 Clash 保留运行。7891 已通过 App 保存。

继续启动暴露 helper 沿用原版 Clash core-execution.lock，导致端口不同仍然互斥。macOS 的 SI Assist helper 改用 si-assist-service.core-execution.lock；生产/开发渠道继续共享 SI Assist 锁，同一 App 的跨进程互斥、退出前持锁、文件安全检查保持。原版锁不删除、不解锁，原版服务不更新。

Helper protocol revision 10 标记命名空间隔离修复，当前客户端要求 revision 10；权限范围和 IPC 操作不扩张。启动时区分服务缺失、需要升级、当前 App 未登记，并在前端显示修复入口；操作错误保留在页面，避免 2 秒通知消失。

8 项 helper 执行锁测试与 36 项网络/App UI 回归通过；其余最终运行证据待打包复验。当前 AgentNEO 保存正文仍是旧版空模板，更新订阅未确认成功；不将空模板启动作为真实节点代理验收。诊断临时副本已清除，订阅地址/凭据不写入报告。

## 交付与真机复验

- Apple Silicon 和 Intel 包已重建并通过 CPU、严格签名、ZIP 完整性和摘要验证；报告 build/reports/coexistence-packages-verified.json。helper 有预期变更，不沿用 RUN16 二进制相同结论。
- 用户完成 revision 10 系统认证，原生服务登记提示消失；只读版本查询确认 epoch 2 / revision 10。
- AgentNEO 原有远程记录保留 ID、订阅地址与 1440 分钟更新设置；将原版 Clash 同名缓存的 31 节点 / 9 分组正文保存到 SI Assist。未改写原版缓存。在线订阅更新尚未验收，不将缓存恢复计为在线刷新成功。
- SI Assist 在 127.0.0.1:7891 受管启动，原版 Clash 的 PID 73042 / 7890 同时保留。系统 HTTP/HTTPS/SOCKS 代理指向 7891。
- 经显式 7891 代理访问 gstatic generate_204 返回 204（0.8714s），无账号访问 api.openai.com/v1/models 返回 401（6.0082s），只证明网络连通，不替代 AI 账号授权或调用验收。
- 停止 SI Assist 后 7891 释放，系统代理恢复为原版 7890，原版 PID 73042 未变。随后重新启动 SI Assist，保留运行。
- TUN 本轮未开启；revision 10 的 TUN/崩溃恢复、Intel 真机及完整提案验收继续待执行。内部包未公证。

首次立即重启曾再次出现 mixed port is occupied，未发现 7891 的其他监听；稍后重试成功，最终 SI Assist PID 88702 / 7891、原版 PID 73042 / 7890 同时监听，系统代理为 7891。短间隔重启的端口可用性预检仍需专项回归，不把本次重试解释为所有重启时序均已验收。

最终节点复验：自动 URLTest 重启后切换到香港中转5，gstatic 出现一次 TLS 失败。将 ⚡️代理 从 🔄自动 改为 x1.0 美西 - 直连1 后，gstatic 返回 204 / 1.002941s，OpenAI 无凭据端点返回 401 / 1.069659s；报告 coexistence-final-connectivity.json。最终保留此节点和 7891 受管运行，截图 coexistence-running-7891.png，内核内存43.1MiB。节点质量和在线订阅刷新不作整体保证。

## 外部系统代理关闭后的独立运行修复（2026-10-16）

用户报告关闭 Clash Verge 系统代理后，SI Assist 出现代理守卫及端口占用提示。本轮区分共享的 macOS 系统代理与独立的 SI Assist 内核：

- 守卫只检查所有权。包括全部关闭在内的外部修改或读取失败只暂停自动接管，不写入 runtime.error、不停止内核、不释放会话、不改写外部代理，也不再重复提交完全相同的 helper 代理事务。
- 运行页面展示非致命状态提示，并提供“重新应用系统代理”。这是用户显式接管：先由现有 helper 的 CAS 恢复释放旧日志，保留外部修改，再将当前外部值作为新回滚基线应用 SI Assist 代理。操作使用当前 generation 和会话，内核不重启；失败也不改变内核运行状态。
- 正常停止清除旧守卫标记，避免停止后仍提示重启守卫。
- 端口预检先检测本机实际连接，再通过 std 的可复用监听验证，覆盖 LAN 通配监听可能与具体地址监听并存的 macOS 边界。正常关闭连接后的端口重用纳入回归。真实占用仍拒绝启动并给出具体端口；不杀进程、不自动抢原版 Clash 的 7890。保留用户选择的 SI Assist 7891。
- 未修改 helper revision 10 的二进制、权限、原版 Clash 服务或配置。重新构建 App 后仍需要为新的代码身份登记服务。

补充核对：Rust std 在此 macOS 上本身启用 SO_REUSEADDR，历史占用报错不能仅归因于 TIME_WAIT；此前非复用 socket 的 Python 实验不能代表旧 Rust 接口。保留此纠正，最终以真实停止/启动证据判断重启是否通过。自动回归和真机复验结果将在本节补录；此段描述不替代验收证据。

自动验证：类型检查通过；网络/App 界面 38 项通过；网络 Rust 39 项通过；OpenSpec strict 通过。Apple Silicon 包已生成且严格签名通过，与基线 helper 摘要一致。当前等待用户在 macOS 系统窗口完成 Keychain 授权；真机复验尚未执行。

真机第一轮：外部将 Wi-Fi HTTP/HTTPS/SOCKS 全关闭后，SI Assist PID 8601 / 7891 与原版 PID 73042 / 7890 保留，HTTPS 204；重新应用代理后 SI PID 不变、系统代理恢复 7891、HTTPS 204；停止后恢复全关闭基线。但立即重启仍失败，因此第一轮包不计最终重启验收通过。

追加根因证据：在 SI 受管 root 内核 PID 9451 退出后，netstat 无 7891 LISTEN，但本地 7891 有该 PID 遗留 TIME_WAIT；uid 501 的绑定（SO_REUSEADDR 和 SO_REUSEPORT 两种）均 errno 48，而连接探测为拒绝连接 errno 61。服务与 App 的权限不同，App 的绑定失败不能作为 root 服务端口不可用的依据。最终将 helper 鉴权状态查询提前，服务模式只检查实际监听连接，绑定与运行校验留给自有服务；普通模式保留同权限的 bind/listen 检查。真实外部监听仍一律拦截，不停外部进程。新增权限差异边界回归；最终包和快速重启待再次验证。

最终权限边界修复的网络 Rust 40 项全部通过（包含 managed 模式不调用 App 绑定、普通模式保留绑定失败、两种模式都拒绝实际监听）。前端代码未再改动，沿用已通过的 38 项界面回归与类型检查。最终 Apple Silicon/Intel 包正在重建。

## 最终验收结论（2026-10-16）

最终包通过本轮修复验收。代码与验证已经完成，当前 SI Assist 保持 7891 独立受管运行；原版 Clash PID 73042 / 7890 全程保留。

- 40 项网络 Rust、38 项界面回归、类型检查和 OpenSpec strict 通过。双架构最终包均通过严格签名、全部内置可执行文件 CPU、ZIP 校验与摘要、相同前端校验；helper revision 10 与修复前基线二进制摘要相同。
- 最终包连续三轮正常停止并快速启动均成功，各轮实际 HTTPS 经 7891 返回 204。第一轮重启前仍捕获到 root 旧连接 TIME_WAIT，uid 501 试绑定 errno 48；最终服务模式能启动，证明不再因 App 权限层试绑定误判而阻塞服务。
- 最终包外部关闭全部 HTTP/HTTPS/SOCKS 后，经过 38 秒以上和守卫检查，PID 13417 仍监听 7891，HTTPS 204；界面显示非致命状态，不再把代理所有权变更当作内核错误。
- 显式重新应用后系统代理回到 7891，PID 13417 不变，HTTPS 204；页面警告清除。正常停止恢复全关闭基线，未重新开启旧 Clash 系统代理；停止页无旧守卫提示。
- 最终截图：build/reports/proxy-independence-final-running.png；外部关闭截图：proxy-independence-external-disabled.png。结构化断言：proxy-independence-regression.json、proxy-independence-machine.json、proxy-independence-packages-verified.json。首轮未通过重启的记录保留并标注为修复前迭代，不计最终通过。

剩余边界：macOS 系统代理本身为共享设置，外部关闭后不抢回；需要系统流量走 SI Assist 时点击“重新应用系统代理”，内核与显式 7891 连接持续可用。Intel 真机继续未通过；真实 AI 账号登录延后；TUN 本轮未复测；内部包临时签名且未公证。在线订阅刷新与完整提案验收仍沿用此前未完成状态，不计入本次修复的通过范围。
