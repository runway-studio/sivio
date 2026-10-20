# Sivio 运行中应用网络设置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户运行中保存端口和网络设置后自动校验、应用，失败保留旧配置并恢复旧运行状态；停机保存不启动网络。

**Architecture:** 在现有 NetworkState.write 串行边界内执行事务，复用 compose_with_profile、validate_core、start/shutdown 和 repository CAS。独立 settings_update 模块拥有应用顺序与恢复规则，用小型后端接口测试生产事务，真实后端负责配置、内核和 helper。候选运行就绪后才提交 catalog，提交失败也清理候选并恢复旧运行；恢复失败必须报告实际失败，不能假报成功。保留原有管理员权限、代理所有权和 generation 约束。

**Tech Stack:** Tauri 2 / Rust 1.99、React 18 / Vite CSR、TanStack Query 5、Vitest 2；不增加依赖。

---

用户已在本聊天明确授权实施和打包；本次补齐既有 OpenSpec F24/F26 的运行时设置应用行为，不重新请求授权，不创建分支或提交。由于用户已要求直接实施，计划审阅后在当前会话执行；不等待执行方式选择。

### Task 1: 固化事务与验收规则

**Files:** Modify `openspec/changes/add-unified-ai-macos-app/specs/network-proxy/spec.md`; Create `app/src-tauri/src/network/settings_update.rs`.

- [x] 添加运行中成功、校验失败不打断、应用/提交失败回滚、回滚失败诚实状态、停止保存、并发过期请求场景。`openspec validate add-unified-ai-macos-app --strict` 通过。
- [x] 在 settings_update 中测试生产事务顺序：revision 检查 → 完整活动订阅合成/校验和端口预检 → 停旧 → 启新并确认就绪 → CAS 保存。覆盖模式、DNS、LAN、端口等统一 Settings；相同设置不重启。
- [x] 使用故障注入覆盖校验失败、候选启动失败/部分启动、配置提交失败、旧内核恢复失败、清理失败及过期 revision；assert 旧配置不变、运行/停止状态、错误说明和调用顺序。候选清理失败不启动第二个内核。

### Task 2: 接入真实生命周期

**Files:** Modify `app/src-tauri/src/network/mod.rs`, `port.rs`, `proxy_guard.rs`; implement live backend in `settings_update.rs`.

- [x] 接管 settings.save，持有 state.write，复用活动订阅真实正文/增强；对停机且无订阅保留 compose 空配置校验。
- [x] 对候选启用的混合、HTTP、SOCKS、Redir、PAC、控制器端口预检；运行中跳过当前自有监听端口，允许交换原端口；停旧后再次检查所有候选端口。不得停止外部进程。用真实 TCP listener 测试冲突/复用。
- [x] 保留 shutdown 对 helper 租约和系统代理 CAS 恢复；等待 PAC/控制器任务停止释放端口；候选就绪验证包括控制通道和实际代理监听。
- [x] 记录并保留原来的代理接管暂停状态；无关设置保存和失败回滚不抢回其他应用已修改的系统代理。显式代理设置修改可按原确认规则应用。恢复旧活动订阅、节点选择和旧运行模式，generation 递增防止旧请求操作新内核。
- [x] 错误包含“旧配置保持/旧运行已恢复”或具体恢复失败；新设置未提交时仍保留草稿。恢复失败将运行状态标为 failed 并保留清理所需会话。

### Task 3: 界面和缓存

**Files:** Modify `app/src/components/network/NetworkSettingsPanel.tsx`, `NetworkWorkspace.tsx`, `networkText.ts`; Test `app/tests/components/NetworkWorkspace.test.tsx`.

- [x] 移除设置表单/DNS 编辑器/保存按钮的运行状态限制；安装卸载 helper 仍需停机。显示运行中保存会自动重新应用及短暂断开提示，保存中防重和关闭保护保留。
- [x] settings.save 返回 saved/restarted；成功后重取配置和 runtime；失败也刷新 runtime/配置 revision，同时保留用户草稿与可重试 revision，防止回滚后 stale revision。保存错误留在弹窗。
- [x] 交互测试运行中端口保存、DNS/设置可编辑、保存中禁用/导航保护、失败保留草稿和刷新状态、重试成功、停机保存提示及英文文案。

### Task 4: 验证与打包

**Files:** output `build/reports/live-network-settings-*`, `dist/internal-aarch64/Sivio.app`; delivery notes `docs/implementation/live-network-settings.md`.

- [x] `pnpm typecheck`，`pnpm exec vitest run tests/components/NetworkWorkspace.test.tsx`；按失败或变更范围运行相关回归。
- [x] 用项目 CARGO_HOME、Rust 1.99 和 MACOSX_DEPLOYMENT_TARGET=12.0 运行 `cargo test --offline --manifest-path app/src-tauri/Cargo.toml --lib network:: -- --test-threads=1`。事务故障注入不声称为真实 helper/TUN 验证。
- [x] 在隔离目录/临时可用端口验证真实 Mihomo 配置校验、监听切换和旧端口恢复，避免改用户现有配置或系统代理。可用时通过测试挂钩验证实际生产事务；无法覆盖的 helper/TUN 真机项如实记录。
- [x] `python3 scripts/build-app.py --arch aarch64`；检查最终 Info.plist、aarch64 可执行、deep/strict 签名、ZIP 内容与实际 app 一致。更新本计划和交付记录，只标记实际通过事项。
