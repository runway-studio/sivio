# Sivio Network Helper

本目录是随 Sivio 维护、编译和交付的网络服务分支。`vendor/upstream/clash-verge-service-ipc` 为上游参考快照；不在应用运行时下载或用上游二进制替换本目录产物。上游许可证与来源记录继续保留，Rust crate 名暂留 `clash_verge_service_ipc` 以兼容内部调用。

## 对外名称

- `sivio-helper`：后台网络服务。
- `sivio-helper-install`：安装、修复、服务升级和客户端登记。
- `sivio-helper-uninstall`：卸载与资源清理。
- macOS 显示名称：`Sivio Network Helper`。

Cargo bin 声明、macOS Info.plist、应用调用、安装器寻找同目录服务文件、打包资源与签名列表必须同步。`si-helper-control` 是现有诊断工具，不是后台服务。

## 已安装版本兼容

保留 `local.siassist.desktop.service`、`si-assist-service` 数据目录、IPC 地址及现有 owner 凭据文件名，使改名安装继续使用原服务身份与恢复记录。安装器先停止同一 launchd 服务、完成原会话恢复，再发布新二进制并更新启动路径；新服务就绪后，仅删除本服务 bundle 内的旧 `clash-verge-service`。卸载仍按原 bundle ID 清理整套服务。

打包时删除资源目录中的旧服务、安装器和卸载器，避免增量构建夹带旧名称。进程冲突检测同时识别新旧名字；不得把改名当作放宽鉴权、双内核保护或删除其他 Clash Verge 安装的理由。

## 本地验证

使用仓库缓存与锁定的 Rust 1.99.0，在仓库根目录执行：

```sh
CARGO_HOME="$PWD/build/cache/cargo" cargo +1.99.0 test --offline --manifest-path native/helper/Cargo.toml --features standalone,client,test --bin sivio-helper-install --test test_installer_arguments
CARGO_HOME="$PWD/build/cache/cargo" cargo +1.99.0 test --offline --manifest-path native/helper/Cargo.toml --features standalone,client,test --lib an_idle_helper_from_the_other_channel_does_not_block_fallback
CARGO_HOME="$PWD/build/cache/cargo" cargo +1.99.0 build --offline --manifest-path native/helper/Cargo.toml --features standalone,client --bins
```

测试产物启用了 `test` 功能，不能用于分发；打包沿用 `scripts/build-app.py`。安装与实际 macOS 授权弹窗仍需用已签名完整应用验证。
