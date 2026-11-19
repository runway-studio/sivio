## Decisions
- 使用 React 18 / Vite CSR、TanStack Query 5、Radix 和既有主题 token。复用 Button/Dialog/SearchField、NetworkRuntimeProvider、networkApi、modelHubApi 和 WorkspaceReadiness。
- DomainRail/Sidebar/WorkspaceFrame 布局保持；网络启动与代理恢复继续走原实现。
- 节点选择在 network 领域共享，概览与网络首页使用同一查询契约。读失败禁止显示缓存成功、写入携带运行代次，写成功/刷新失败分别表达。
- 网络摘要只主动检测固定已有 Apple 目标；不能据此宣称所有节点/AI 可用。结果绑定配置与运行身份，变更、窗口失焦、网络事件和超时使结果失效，迟到响应被拒绝。
- 模型页继续沿用供应商/模型/revision 契约，AI 出站只展示既有全局配置并导航修改，不伪造每客户端独立出口设置；草稿在刷新或失败时保留，切换客户端前确认放弃。
- 没有可信的持久操作历史时展示实际订阅更新时间/错误和运行状态，不生成虚构的时间线。

## Validation
类型检查、定向组件/导航回归、renderer 构建、真实浏览器渲染和键盘/不同宽度检查；浏览器隔离 IPC 夹具不代替真实网络、TUN、付费模型与睡眠/换网真机验收。本次不操作用户真实代理或账号。
