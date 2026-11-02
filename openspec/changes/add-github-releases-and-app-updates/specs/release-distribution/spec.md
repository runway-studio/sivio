## ADDED Requirements

### Requirement: 可追溯的版本发行
系统 SHALL 从固定 tag/SHA 构建 Sivio，校验 App 版本一致，先准备 Release 草稿，在全部必需资产通过校验后才发布；禁止覆盖已发布资产或让较旧 stable 取代较新版本。

#### Scenario: stable 发布
- **WHEN** vX.Y.Z 对应源码、版本、全部必需资产及签名通过检查
- **THEN** 发布包含安装包、更新归档、签名、latest.json、SHA256、源码和发行说明的版本

#### Scenario: 失败或重复运行
- **WHEN** 资产缺失、版本不一致、签名无效或 tag 对应已发布资产
- **THEN** 停止发布且不覆盖已有 Release，不改变有效 stable 更新源

#### Scenario: 预发布隔离
- **WHEN** vX.Y.Z-rc.N 构建通过
- **THEN** 仅作为 prerelease 手动下载，不设置为 latest，不进入 stable 自动更新

### Requirement: 可复现完整离线产物
系统 SHALL 在干净 runner 从锁定依赖及内核清单构建，保留双内核离线恢复、签名身份和源码对应关系；发行构建不得隐式生成新签名身份。

#### Scenario: 无本机缓存构建
- **WHEN** runner 没有本地 build/cache 或 app resources
- **THEN** 准备固定摘要内核、依赖通知及源码，构建包含完整运行资源的签名 App

#### Scenario: 发行凭据缺失
- **WHEN** 发行所需更新私钥或稳定 macOS 身份不可用
- **THEN** 明确失败，不上传可被自动更新消费的无签名或临时身份包

### Requirement: 可读取的完整更新清单
系统 SHALL 仅为已验证架构生成 Tauri 静态清单，签名字段为真实签名内容，下载地址引用该版本不可变资产；正式 feed 必须可被目标用户访问。

#### Scenario: Apple Silicon 首发
- **WHEN** 仅 Apple Silicon 通过本轮验收
- **THEN** 仅发布 darwin-aarch64 平台项，Intel 不显示为已支持

#### Scenario: 更新源无法匿名访问
- **WHEN** 默认 GitHub feed 或资产需身份验证
- **THEN** 阻止宣称默认更新已可用，要求配置可读取的发行位置，不在 App 内嵌 GitHub token 或改变仓库可见性
