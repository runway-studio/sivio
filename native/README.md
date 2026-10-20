# Sivio native runtime

`helper/` 是固定 service-ipc b2a7427 的独立 GPL 来源副本，`sysproxy/` 和 `kode-bridge/` 为对应 MIT 来源移植；原上游保留于 vendor。身份为 `local.siassist.desktop.service`，socket 为 `/var/run/si-assist-service/service.sock`，不清理原 Clash 服务。

已实现并真机验证：原生管理员安装、内核 audit token / 登记 CDHash 调用方校验、固定核心摘要、root 私有 Mihomo 控制 socket、封闭会话控制 API、5 秒续约 / 30 秒过期、有效/过期租约崩溃恢复、TUN HTTP/DNS 转发与精确系统代理恢复。持久 lease、boot/wake 时钟与恢复 journal 均为 root 私有。

`runtime_sandbox.rs` 为 macOS 内核读写/执行边界；缺失或拒绝启动即失败，没有无沙箱回退。配置在准备和 staging 边界再次校验，持久配置恢复时也必须满足当前边界。普通内核通过 `supervisor/` 保留 Child handle，GUI stdin 关闭后回收自己启动的进程。

构建使用项目独立 Rust 1.99.0 和缓存；实际证据、未通过矩阵见 `docs/implementation/progress.md`。Intel 真机与 macOS12 真机未通过，不能用交叉编译替代。`scripts/prepare-helper.py` 拒绝覆盖已修改源码，历史 identity patch 只记录早期补丁，不是全部当前改动。
