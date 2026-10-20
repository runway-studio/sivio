## ADDED Requirements

### Requirement: F16 直连路由聚合模式
系统 SHALL 提供 直连路由聚合模式，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F16-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 独立为支持客户端切换直连/路由/聚合，聚合模型唯一映射并有默认供应商，明确重启需求和官方限制

#### Scenario: F16-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 仅切换查看页签不得修改配置；仍有客户端接入时直接停止服务被阻止并提供全部回直连操作

### Requirement: F17 协议转换与流式请求
系统 SHALL 提供 协议转换与流式请求，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F17-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 按基线方向支持 Anthropic/OpenAI Chat/Responses/Gemini 协议，保留流式顺序、工具调用ID、取消和错误语义，整流行为可追踪

#### Scenario: F17-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 不支持的多模态/工具组合返回具体错误而非伪造成功；客户端取消终止上游读取

### Requirement: F18 故障转移健康与连通探测
系统 SHALL 提供 故障转移健康与连通探测，遵守 coverage.md 的客户端支持边界和 design.md 的权限、所有权及生命周期约定。

#### Scenario: F18-success 正常使用
- **WHEN** 用户在受支持的 macOS 环境中使用该能力，且必要依赖可用
- **THEN** 路由模式按队列、超时和熔断策略切换；连通检测与真实请求健康分开；聚合按模型归属路由而不自动故障转移

#### Scenario: F18-failure 异常与边界
- **WHEN** 该操作出现无效输入、权限、依赖、并发或运行异常
- **THEN** 401/403 的可达探测不标记鉴权成功，不改变熔断；失败重试有总次数和截止时间

#### Scenario: F18-stream-commit 已发送部分内容
- **WHEN** 路由已经向客户端发送首个内容块后上游断开
- **THEN** 系统 SHALL 结束该流并返回可见错误，不跨供应商重放、不拼接新流、不重复工具调用

#### Scenario: F18-side-effect 非幂等操作
- **WHEN** 请求含副作用或无法判断上游是否已经处理，且无受支持幂等契约
- **THEN** 系统 SHALL 不自动重放；允许重试的请求总尝试不超过3且首响应预算不超过60秒
