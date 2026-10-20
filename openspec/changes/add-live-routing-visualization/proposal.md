# Change: 路由组实时可视化

## Why
路由组已有调度和决策记录，但缺少网关处理中的可视状态。用户已授权按参考图实现并验证打包。

## What Changes
- 在模型 → 路由组整合客户端、网关、成员连线及并发请求状态。
- 从真实请求生命周期提供有界内存快照、会话统计、最近一次选路过程。
- 显示真实 Retry-After 提示，区分响应头接受、响应体接收完成和中断。

## Impact
- Affected specs: model-routing
- Affected code: proxy route trace/forwarder, model commands, RoutingGroupsPage
