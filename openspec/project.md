# Project Context

## Purpose
sivio-desktop 是面向 macOS 的本地 AI 辅助工具。用户已确认先内部使用，发布方式后定；在单个 App 内整合 CC Switch 与 Clash Verge Rev 的 macOS 用户功能，允许分阶段交付，最终须按完整功能清单验收。

## Current State
用户已批准持续实现并打包。`app/` 为唯一 Tauri 业务宿主，已接入 CC Switch 业务及 Sivio 网络工作区；独立 helper、lease 崩溃恢复、真实 TUN HTTP/DNS 已有 Apple Silicon 真机证据。当前继续补齐迁移、完整偏好和逐操作验收；完整功能对等尚未通过，Intel 真机按用户要求保留未通过。详见 `docs/implementation/progress.md`。`openspec/specs` 保持为空，不归档未通过验收的能力。

## Proposed Stack
Tauri 2、Rust、React、TypeScript、Vite；优先沿用 CC Switch 的 Radix/Tailwind 界面体系。Mihomo 是单独内核进程，特权网络操作由独立 macOS helper 执行。具体工具链锁定属于实施第一阶段，不把两仓库锁文件直接合并。

## Conventions
- 需求、决策与任务用中文，规范保留 OpenSpec Requirement/Scenario 和 SHALL/MUST 关键字。
- 配置意图、客户端实际配置、运行状态分离；UI 不直接改写文件或运行任意 shell。
- 新增功能先提案，任务以验收证据收口；规划完成不代表实现完成。
- Git 分支、提交和发布按后续明确指令执行。本轮不提交或发布。

## Testing Strategy
规划阶段运行 OpenSpec strict、文档链接和需求—任务覆盖检查；实施阶段执行适配器 fixture、代理协议、故障恢复及 macOS 真机验收。Mock 不替代 TUN、签名和安装验证。

## Constraints
仅 macOS；先内部使用，不假定闭源分发权或已获得公开发布许可。不复用原项目 bundle ID、更新公钥、更新端点或特权服务身份。完整范围以提案中的固定源码基线和功能矩阵为准，不无限追随上游 main。

## Dependencies
CC Switch（MIT）、Clash Verge Rev（GPL-3.0-only）、Mihomo 及其服务依赖、Apple SDK/签名基础设施、用户自己的 AI 账号/API Key/订阅源。外部服务的可用性不由本 App 保证。
