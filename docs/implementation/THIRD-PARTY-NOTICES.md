# Sivio 来源与许可证

Sivio 的组合应用包含 GPL-3.0-only 来源，整体按 GPL-3.0-only 处理。CC Switch 的 MIT 署名与许可继续保留。

- CC Switch 4.0.12，farion1231 及贡献者，MIT；固定提交 51ac86f1c59abfefabadebd05ec5a5415b8ad72c。
- Clash Verge Rev 2.5.8，Clash Verge Rev 贡献者，GPL-3.0-only；固定提交 4337bd85758d54d7b9044b2da3c9ac1176eae1f3。网络配置合并、序列增强及固定基线的 builtin_hy_alpn / builtin_meta_guard 兼容转换以其代码为来源移植。
- Clash Verge Service IPC 2.7.6，Tunglies 及贡献者，GPL-3.0；固定提交 b2a7427d6681c8d3780ab83a73f4dc21da2f22d6。独立身份、调用方校验、lease 与恢复属于本项目修改。
- sysproxy 0.7.1，zzzgydi 及贡献者，MIT；原生代理快照和审计令牌校验属于本项目修改。
- kode-bridge 0.5.2，原作者及贡献者，MIT；内核 audit token 传递属于本项目修改。
- Mihomo stable v1.19.32 与 Alpha 94b13ae，MetaCubeX 及贡献者，GPL-3.0；二进制未修改，按固定清单校验。源码入口：[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)。随附源码归档包含 stable 提交 88dcbf7f1614a67c3b36b848ee3592dfa92ada36 与 Alpha 提交 94b13aed49b8dc41973e4bb3f721c5fa2c5c5c1f 的精确源码，摘要见 mihomo-source-manifest.json；完整构建依赖材料核对仍待完成。
- Rust/JavaScript 依赖版本以随附 Cargo.lock 与 pnpm-lock.yaml 为准，各依赖原有许可继续适用。

本地应用 Resources/legal 包含上游许可全文；对应版本的源码归档与 App 在同一下载位置独立提供，不额外收费。Resources/legal/SOURCE.txt 记录精确源码文件名和 SHA256，重新分发时须继续提供对应源码。源码包不参与 App 运行，双内核仍完整内置，首次启动与缓存恢复均无需联网。此记录不代表已经完成外部分发、公证或全部依赖许可证核对。

- macOS 键码映射来自 global-hotkey 0.8.0，Tauri Programme within The Commons Conservancy，提交 2a620bf3852008b568f6d36c2baedcc3dd0822f2；按其 MIT 许可复用，完整通知随依赖材料提供。
