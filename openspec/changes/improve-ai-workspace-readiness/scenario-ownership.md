# 场景验收责任（第二版）

每个Scenario仅指定一个主要收口任务，参与实现的其他任务按tasks.md自己的局部断言完成，不要求提前实现后继。T24最终复验全部核心旅程；阶段门不要求通过未来阶段的场景。

- R02.S1在A先验证单候选/状态，B的T11接预算与诊断计费后最终收口；A阶段不宣称预算控制已交付。
- R14.S4在T10先验单scope派发持久边界，T19再验provider/方案双scope后最终收口。
- R23.S4在T10先验旧消费基线，T19再验新方案无历史归因；既有provider预算不等待方案功能。
- R11文件变更在T18收口；hot_policy及R12在T19实现，T20负责J06全链。
- R13由T11验证provider规则；T19复用同规则接方案预算，R15.S2不作为B阶段退出条件。

| 场景ID | Scenario | 主验收任务 |
| --- | --- | --- |
| R01.S1 | [内核运行但模型失败](specs/workspace-readiness/spec.md) | T03 |
| R01.S2 | [配置变化使证据失效](specs/workspace-readiness/spec.md) | T03 |
| R01.S3 | [显式出站无需系统代理](specs/workspace-readiness/spec.md) | T03 |
| R02.S1 | [单候选真实验证](specs/workspace-readiness/spec.md) | T11 |
| R02.S2 | [取消并重试](specs/workspace-readiness/spec.md) | T02 |
| R02.S3 | [不支持的客户端](specs/workspace-readiness/spec.md) | T02 |
| R03.S1 | [新用户完成接入](specs/ai-tools/spec.md) | T04 |
| R03.S2 | [中断后恢复](specs/ai-tools/spec.md) | T04 |
| R03.S3 | [旧用户升级](specs/ai-tools/spec.md) | T04 |
| R04.S1 | [无供应商或搜索无命中](specs/ai-tools/spec.md) | T04 |
| R04.S2 | [应用成功但客户端未读](specs/ai-tools/spec.md) | T04 |
| R04.S3 | [过期选择](specs/ai-tools/spec.md) | T04 |
| R05.S1 | [老用户隐藏客户端](specs/desktop-shell/spec.md) | T05 |
| R05.S2 | [新装无客户端](specs/desktop-shell/spec.md) | T05 |
| R06.S1 | [键盘导航](specs/desktop-shell/spec.md) | T06 |
| R06.S2 | [写入被保护](specs/desktop-shell/spec.md) | T06 |
| R06.S3 | [秘密不入索引](specs/desktop-shell/spec.md) | T06 |
| R07.S1 | [不兼容候选](specs/model-routing/spec.md) | T08 |
| R07.S2 | [未知能力](specs/model-routing/spec.md) | T08 |
| R07.S3 | [上下文边界](specs/model-routing/spec.md) | T08 |
| R08.S1 | [同账号两模型](specs/model-routing/spec.md) | T09 |
| R08.S2 | [完全重复与迁移](specs/model-routing/spec.md) | T09 |
| R09.S1 | [固定会话并发](specs/model-routing/spec.md) | T12 |
| R09.S2 | [缺身份或固定成员失效](specs/model-routing/spec.md) | T12 |
| R09.S3 | [响应游标重启或换成员](specs/model-routing/spec.md) | T12 |
| R09.S4 | [绑定资源界限](specs/model-routing/spec.md) | T12 |
| R09.S5 | [新旧保护设置与认证轮换](specs/model-routing/spec.md) | T12 |
| R10.S1 | [旧方案与不支持字段](specs/project-environments/spec.md) | T17 |
| R10.S2 | [预览过期或缺引用](specs/project-environments/spec.md) | T17 |
| R11.S1 | [中途失败](specs/project-environments/spec.md) | T18 |
| R11.S2 | [外部编辑与崩溃](specs/project-environments/spec.md) | T18 |
| R11.S3 | [存在在途流](specs/project-environments/spec.md) | T18 |
| R12.S1 | [切换期间在途与新请求](specs/project-environments/spec.md) | T19 |
| R12.S2 | [受管出口失败](specs/project-environments/spec.md) | T19 |
| R12.S3 | [归因能力不足](specs/project-environments/spec.md) | T19 |
| R13.S1 | [非法值与零限额](specs/budget-controls/spec.md) | T11 |
| R13.S2 | [周期边界](specs/budget-controls/spec.md) | T11 |
| R14.S1 | [达到限额后故障切换](specs/budget-controls/spec.md) | T11 |
| R14.S2 | [费用未知或数据库错误](specs/budget-controls/spec.md) | T11 |
| R14.S3 | [流式与重复结算](specs/budget-controls/spec.md) | T11 |
| R14.S4 | [派发持久边界](specs/budget-controls/spec.md) | T19 |
| R14.S5 | [未知费用的可操作处理](specs/budget-controls/spec.md) | T11 |
| R15.S1 | [阈值重启去重](specs/budget-controls/spec.md) | T11 |
| R15.S2 | [请求过程中切换方案](specs/budget-controls/spec.md) | T19 |
| R15.S3 | [价格修正](specs/budget-controls/spec.md) | T11 |
| R16.S1 | [失败后成功与取消](specs/operational-reporting/spec.md) | T22 |
| R16.S2 | [缺失指标](specs/operational-reporting/spec.md) | T22 |
| R16.S3 | [旧数据不足](specs/operational-reporting/spec.md) | T22 |
| R17.S1 | [诊断与生产数据](specs/operational-reporting/spec.md) | T22 |
| R17.S2 | [配置时间邻近](specs/operational-reporting/spec.md) | T22 |
| R17.S3 | [保留与导出](specs/operational-reporting/spec.md) | T21 |
| R18.S1 | [查看网络增强变更](specs/data-lifecycle/spec.md) | T15 |
| R18.S2 | [历史保留](specs/data-lifecycle/spec.md) | T15 |
| R19.S1 | [仅恢复一个对象](specs/data-lifecycle/spec.md) | T16 |
| R19.S2 | [目标或来源变化](specs/data-lifecycle/spec.md) | T16 |
| R19.S3 | [中断及缺秘密](specs/data-lifecycle/spec.md) | T16 |
| R19.S4 | [脱敏对象替换活动依赖](specs/data-lifecycle/spec.md) | T16 |
| R20.S1 | [并发写入](specs/data-lifecycle/spec.md) | T14 |
| R20.S2 | [恢复服务失败](specs/data-lifecycle/spec.md) | T20 |
| R20.S3 | [秘密和链接](specs/data-lifecycle/spec.md) | T16 |
| R21.S1 | [最终包验证](specs/integration-runtime/spec.md) | T23 |
| R21.S2 | [外部依赖缺失](specs/integration-runtime/spec.md) | T24 |
| R22.S1 | [完整核心旅程](specs/integration-runtime/spec.md) | T24 |
| R22.S2 | [性能及并行网络](specs/integration-runtime/spec.md) | T24 |
| R23.S1 | [旧库升级失败或降级](specs/data-lifecycle/spec.md) | T01 |
| R23.S2 | [配置恢复与消费](specs/data-lifecycle/spec.md) | T16 |
| R23.S3 | [完整灾备恢复](specs/data-lifecycle/spec.md) | T16 |
| R23.S4 | [预算启用的历史基线](specs/data-lifecycle/spec.md) | T19 |
