# M0 request-path experiment

独立于产品页面的 Rust HTTP 转发样条，验证本机 fixture client → route → 固定 Mihomo → 本机 mock upstream。没有复制原型数据或调用外部 AI 服务。

运行：设置 `RUSTUP_TOOLCHAIN=1.99.0`、项目 `CARGO_HOME` 和 `SI_MIHOMO_BINARY`（已通过 scripts/fetch-mihomo.py 校验的本机内核），然后执行 `cargo test --locked --manifest-path experiments/m0-path/Cargo.toml`。

测试验证 direct / managed-network / custom-proxy、响应首块未被完整缓冲、客户端丢弃流、内核停止后新请求 502 且上游未收到请求。丢弃客户端流仅验证该操作可执行，没有证明上游取消传播或所有资源均已回收。

仅是 T04 的非 TUN 通路样条，不实现模型协议转换、生产鉴权、重试/熔断或 TUN 防回环；没有作为完整 AI Router 发布。正式合并前仍需按设计验证所有输入边界、HTTP 头语义与故障恢复。
