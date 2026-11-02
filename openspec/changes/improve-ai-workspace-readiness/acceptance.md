# 验收与覆盖

## 分层与完成口径
本文件保留规划时定义的验收要求；实际执行结果见[阶段A验收结果](stage-a-acceptance.md)。下述V/J列表本身不代表测试已经通过。
- V01：TypeScript与组件交互。命令 pnpm --dir app typecheck；pnpm --dir app test:unit --maxWorkers=2 --minWorkers=1；pnpm --dir app build:renderer。定向优先使用现有ModelHub、NetworkHome、NetworkWorkspace、RoutingGroups、RoutingLivePanel、UsageDashboard、SyncPrivacySection测试，新增对应引导/命令/环境测试；最终阶段再跑全量。
- V02：Rust单元/隔离数据库及故障注入。默认命令如下（可先做定向过滤加速，最终不可用零匹配代替）：
  - RUSTUP_TOOLCHAIN=1.99.0 cargo test --manifest-path app/src-tauri/Cargo.toml --lib -- --test-threads=1
  - RUSTUP_TOOLCHAIN=1.99.0 cargo test --manifest-path app/src-tauri/Cargo.toml --test profile_roundtrip -- --test-threads=1
  - RUSTUP_TOOLCHAIN=1.99.0 cargo test --manifest-path app/src-tauri/Cargo.toml --test import_export_sync -- --test-threads=1
  覆盖mode、proxy、routing_groups、usage_stats、profile、sync_protocol、restore_journal，禁止将“0个匹配测试”当通过。
- V03：真实本机HTTP/SSE夹具与隔离HOME。模拟四协议、认证/限流/流式取消/费用未知；供应商只用合成凭据，实际断言上游收到了哪个model、出口和attempt。不消费真实模型额度。
- V04：当前原生包。复用[原性能与恢复验收](../add-unified-ai-macos-app/acceptance.md)，冷启p95≤5s、缓存列表p95≤200ms、10分钟空闲CPU≤5%单核且RSS≤600MiB、本地Router额外开销p95≤50ms、20路10分钟流式无丢帧/串流/结束泄漏；报告具体样本数和进程集合。新增就绪/报告不能让后台轮询继续付费或越界；不将浏览器mock计作原生。
- V05：人工真实环境。用户提供测试账号/设备及系统授权，明确确认可能消耗额度后执行。保留macOS版本、架构、包hash、起止代理/接口/配置摘要，恢复测试前状态。缺资源记NOT_VERIFIED，不能PASS或把Required降为可选。

## 核心旅程
| ID | 前置与步骤 | 必须观察的结果 | 层次 |
| --- | --- | --- | --- |
| J01 新装接入 | 干净隔离数据；选择客户端→导入→选模型→主动验证→打开客户端；另跑取消/unsupported | 四客户端有效响应才pass；其他客户端配置可完成且unsupported明确；无自动TUN/系统代理/付费请求 | V01/V03/V04/V05 |
| J02 恢复与空状态 | 中途退出/跳过/重启；无供应商、无命中；外部更改目标配置 | 继续正确步骤；CTA返回原上下文；陈旧提交拒绝，验证证据stale | V01/V02 |
| J03 常用操作 | 旧隐藏排序迁移；Cmd+K搜模型/节点/会话；有草稿/忙状态/IME输入 | 概览和侧栏一致；正确能力和禁用原因；写操作不绕过保护；焦点恢复 | V01/V04 |
| J04 路由连续性 | 同账号两模型、能力不匹配、稳定ID并发、Generated、response游标、凭据变更、重启 | 正确候选/模型；排除原因明确；五策略保持；受保护游标不跨归属；未知身份不伪造固定 | V02/V03 |
| J05 预算 | 固定UTC offset跨日/月/DST；80%/100%；空/0/正数×两模式；unknown核对；旧opening；30并发流；故障切换/诊断 | B只验provider/无方案，C增加方案双scope；pending提交先于发送；旧消费不清零双计；observe不阻止、block_new按表阻止；unknown核对可见；在途继续、回调/通知幂等 | V01/V02/V03 |
| J06 环境 | Claude/Codex并行；分hot_policy（只策略/指针）与app_configuration（文件/资源）；中间写失败/外部编辑/崩溃 | hot_policy：在途A、新流B；app_configuration：目标app排空，30秒未排空busy释放且不改配置；两类均不关共享listener/Mihomo、Codex持续可用；失败补偿或recovery_required | V02/V03/V04 |
| J07 选择恢复 | 分别恢复五类单对象、分类；缺依赖/秘密、错误口令、损坏归档、磁盘满、每持久边界强杀 | 未选对象及消费账本不变；预览/目标CAS；秘密不泄漏；不自动激活；安全恢复或保留现场 | V02/V03/V04 |
| J08 报告 | 固定数据集：2成功（其一先429），1失败，1取消，1unknown；诊断另计；有/无TTFT和价格 | 成功率2/3；attempt的429=1；取消/unknown单列；已知费用和未知数正确；分位数注明近似及样本；不足90天不补造数据；另用TTFT样本80/200/600/1200/6000ms验证近似p50=1000ms、p95=10000ms | V01/V02 |
| J09 生命周期 | 当前包新装/升级；调用→切模型→切网络→睡眠唤醒→恢复；与原Clash并存 | 各状态及时更新；旧验证失效；无凭据丢失或静默直连；退出恢复原网络基线；更新/降级符合schema规则 | V04/V05 |

## 平台和能力矩阵
- 每阶段可在Apple Silicon当前开发系统完成隔离实现验收；对外声称支持的macOS12+/Intel组合，最终必须有相应真机证据。Apple Silicon/macOS12、Apple Silicon当前系统、Intel/macOS12、Intel受支持系统分别记PASS/FAIL/NOT_VERIFIED及证据，不从一个格推广其他格。
- 四网关客户端在本机协议夹具全覆盖；真实四客户端各至少一次配置→调用→切换→错误恢复，官方凭据不支持的组合按产品限制列明NOT_SUPPORTED而非测试通过。
- TUN/helper/系统代理升级及睡眠切网仅在已授权测试环境做；模型配置只读验证不等于外部进程重载验证。
- 只要Required旅程/目标平台仍有FAIL/NOT_VERIFIED，T24保持未完成；可以单独发布已有证据的内部阶段构建并标明限制，不能将完整change标完成。

## 需求—任务—场景映射
下表是需求参与关系，不要求每个参与任务独立验收全部后续场景。全部场景均有一个主要验收任务，详见[场景责任表](scenario-ownership.md)；阶段门只验截至本阶段已交付子集，T24复验全部J旅程。T18先收口文件恢复，T19接请求快照，T20验完整J06；B仅provider预算，C才验方案预算/归因。场景名称及WHEN/THEN以spec为准。

| Requirement | 任务 | 场景数 |
| --- | --- | --- |
| [R01 按证据展示就绪状态](specs/workspace-readiness/spec.md) | T01, T03 | 3 |
| [R02 可取消的端到端诊断](specs/workspace-readiness/spec.md) | T02, T11 | 3 |
| [R03 可恢复的首次接入流程](specs/ai-tools/spec.md) | T04 | 3 |
| [R04 模型选择的空状态与生效反馈](specs/ai-tools/spec.md) | T04 | 3 |
| [R05 一致的常用工具展示与能力标签](specs/desktop-shell/spec.md) | T05 | 2 |
| [R06 受保护的应用内命令面板](specs/desktop-shell/spec.md) | T06 | 3 |
| [R07 能力约束先于路由策略](specs/model-routing/spec.md) | T08, T13 | 3 |
| [R08 同供应商多模型的独立候选](specs/model-routing/spec.md) | T09, T13 | 2 |
| [R09 可解释的会话固定与游标归属](specs/model-routing/spec.md) | T12, T13 | 5 |
| [R10 扩展现有方案并预览作用范围](specs/project-environments/spec.md) | T17, T20 | 2 |
| [R11 方案的可恢复应用](specs/project-environments/spec.md) | T14, T18, T19, T20 | 3 |
| [R12 请求级环境归属与出站隔离](specs/project-environments/spec.md) | T19, T20 | 3 |
| [R13 明确范围的预算设置](specs/budget-controls/spec.md) | T10, T11, T13, T19 | 2 |
| [R14 所有尝试的预算准入与未知费用](specs/budget-controls/spec.md) | T10, T11, T13, T19 | 5 |
| [R15 预算提示与准确的方案归因](specs/budget-controls/spec.md) | T11, T13, T19 | 3 |
| [R16 可解释的运行质量指标](specs/operational-reporting/spec.md) | T21, T22 | 3 |
| [R17 报告关联与本地隐私边界](specs/operational-reporting/spec.md) | T21, T22 | 3 |
| [R18 对象级配置历史与来源差异](specs/data-lifecycle/spec.md) | T15, T20 | 2 |
| [R19 预览绑定的选择恢复](specs/data-lifecycle/spec.md) | T16, T20 | 4 |
| [R20 恢复操作协调与私有材料](specs/data-lifecycle/spec.md) | T14, T15, T16, T18, T20 | 3 |
| [R21 阶段与当前构建证据](specs/integration-runtime/spec.md) | T07, T13, T20, T23, T24 | 2 |
| [R22 核心旅程与性能回归](specs/integration-runtime/spec.md) | T07, T13, T20, T24 | 2 |
| [R23 增量迁移与运行数据隔离](specs/data-lifecycle/spec.md) | T01, T10, T14, T16, T17, T19, T20, T21 | 4 |

## 规划验证
- openspec validate improve-ai-workspace-readiness --strict
- 解析本提案全部Requirement/Scenario，确认ID唯一、任务引用存在、每需求至少一个任务、每任务有验收、无缺失本地Markdown链接。
- 三门各自报告审阅范围、P0/P1/P2、证据、修复建议和最终结论；修订后复核同一问题，不因重复措辞开启无效新循环。
