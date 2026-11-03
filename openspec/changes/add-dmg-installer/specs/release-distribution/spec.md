## ADDED Requirements

### Requirement: DMG 拖拽安装
系统 SHALL 从最终签名 App 生成包含 Sivio.app、指向 /Applications 的快捷入口及内部签名安装说明的只读 DMG，并保持应用内容及签名不变。

#### Scenario: 首次手动安装
- **WHEN** 用户打开 DMG
- **THEN** 可将 App 拖到 Applications，说明要求先退出旧版、复制完成后推出映像，并明确首次运行可能需要用户手动允许

#### Scenario: 发布校验
- **WHEN** 发布新版本
- **THEN** 核验 DMG 中 App 与签名原件一致、签名有效且隐私扫描通过，将 DMG 纳入 SHA256SUMS 与发布后匿名回读
