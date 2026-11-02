## ADDED Requirements

### Requirement: R01 按证据展示就绪状态
系统 SHALL 分别展示配置已保存、客户端读取状态、网关运行、所选出口和最近模型验证；每项记录版本、时间和 unknown/pending/pass/fail/unsupported/stale。运行中不得等同模型可用，客户端未观测重载必须为unknown。验证在10分钟后或相关配置/认证/出口变更后过期。

#### Scenario: 内核运行但模型失败
- **WHEN** 内核运行而指定模型验证返回鉴权错误
- **THEN** 概览和网络页均保持内核运行、模型fail，并提供授权入口，不显示整体已连通

#### Scenario: 配置变化使证据失效
- **WHEN** provider/model/mode/outbound/credential版本或network generation改变
- **THEN** 旧验证立即stale，迟到结果不能覆盖新状态；不自动发起付费探测

#### Scenario: 显式出站无需系统代理
- **WHEN** 客户端使用direct或显式custom/managed且系统代理关闭
- **THEN** 按所选出口评价，不将系统代理关闭单独判作AI不可用

### Requirement: R02 可取消的端到端诊断
系统 SHALL 支持只读本地检查及用户主动发起的四客户端模型验证；每客户端最多一个诊断，总超时30秒，取消后关闭上游读取并拒绝迟到结果。探测复用适配器/预算/出站，只用固定合成内容，记录purpose=diagnostic，不改变配置或生产调度/熔断/粘性。

#### Scenario: 单候选真实验证
- **WHEN** 用户确认指定模型可能消耗额度并开始探测
- **THEN** 依次验证配置、网关/出口、鉴权和有效模型响应；401/429/5xx分别报告，不以HTTP可达为成功，不自动切换备用候选

#### Scenario: 取消并重试
- **WHEN** 探测等待期间用户取消或再次发起
- **THEN** 取消不承诺费用退还；并发发起返回busy；旧请求迟到不覆盖新run结果

#### Scenario: 不支持的客户端
- **WHEN** 用户对非四网关客户端或不支持的凭据发起验证
- **THEN** 显示unsupported及手动验证步骤，禁止伪造成功且允许配置引导完成
