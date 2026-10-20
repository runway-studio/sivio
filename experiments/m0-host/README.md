# SI Assist M0 host

T02 的隔离单宿主构建样条，包含 CC provider 数据结构兼容探针与 CV YAML/主页 URL 校验探针。它用于验证移植依赖、原生 IPC 和包身份，不能代表 M0 或完整集成已通过。产品页面在 T04 通过后迁移。

固定工具：Rust 1.99.0、Node 24.21.0、pnpm 10.13.1、Tauri / CLI 2.12.1。无应用更新插件、无上游全局 AppHandle/托盘。前端是 M0 专用验证表单，不使用设计原型模拟行为。

来源：`provider.rs` 的 Provider 结构摘自 CC Switch 51ac86f（MIT），将 ProviderMeta 降为 opaque JSON 并增加根级 flatten；不包含配置切换服务。`profile.rs` 的 normalize_profile_home_url 摘自 Clash Verge Rev 4337bd8（GPL-3.0-only），仅将 tauri::Url 改为 url::Url。YAML 检查按 CV validate_file_syntax_outcome 的 serde_yaml_ng 路径实现；内核检查只调用固定随包资源，不接受任意可执行路径。

上游许可证完整保留于 `vendor/upstream/`。本实验包含 GPL 来源，声明 GPL-3.0-only。其声明限于实验，不提前决定最终产品发布方式。
