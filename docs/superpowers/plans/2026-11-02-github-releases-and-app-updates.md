# Sivio GitHub Releases and App Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 本仓库执行边界优先：须先获批 OpenSpec 提案；若上述执行技能不可用，使用本会话逐项实施即可，不把缺少可选执行框架变成业务阻塞。不在未经授权时创建 tag 或发布。

**Goal:** 为 Sivio 建立可复现 GitHub Releases，并提供有签名校验、网络清理和数据保留的应用内升级。

**Architecture:** 复用现有离线构建和 Rust updater；增加发行资产生成与 Actions，统一官方源解析和候选安装状态。客户端只下载完整、已签名的自有 App，发布事务与应用更新事务分别验证。

**Tech Stack:** Tauri 2 / Rust、React / TypeScript、Python 3、GitHub Actions、macOS codesign、Tauri minisign。

---

## 输入与验收契约

- 规范：[proposal](../../../openspec/changes/add-github-releases-and-app-updates/proposal.md)、[design](../../../openspec/changes/add-github-releases-and-app-updates/design.md)、[release-distribution](../../../openspec/changes/add-github-releases-and-app-updates/specs/release-distribution/spec.md)、[app-updates](../../../openspec/changes/add-github-releases-and-app-updates/specs/app-updates/spec.md)。
- 工作目录为本仓库根。基线 `f67e919`，版本仍 0.1.0；本文示例 0.2.0 不代表授权发布该版本。
- 用户已确认 Apple Silicon / 稳定内部签名，保留系统首次安装提示；方案采用 stable 自动更新。签名材料与发行位置属于外部输入；其缺失不阻止获批后 1–6 的实现和公开测试向量验证，但阻止真实发布及成功声明。
- 测试不要调用用户模型账号、修改用户系统代理或替换正在运行的 App。原生升级用隔离 App 路径、隔离数据与自有测试网络资源；需要特权 helper 的验收安排在明确的隔离测试环境。

## Task 1: 版本与发行资产契约

**Files:** 新增 `scripts/release/version.py`、`scripts/release/manifest.py`、`scripts/release/test_version.py`、`scripts/release/test_manifest.py`；修改 `app/src-tauri/tauri.conf.json`、`app/package.json`、`app/src-tauri/Cargo.toml`、本包 Cargo.lock 版本。

- [ ] 写失败测试：三个产品版本和 Cargo.lock 不一致、非 SemVer、非法 tag、缺平台/归档/签名/源码、重复资产、非 HTTPS、已有 stable 更高、RC 不得设 latest。每个异常断言非零退出且不输出可发布 manifest。
- [ ] 执行 `python3 -m unittest discover -s scripts/release -p 'test_*.py'`，确认失败原因是尚未实现。
- [ ] 实现 `version.py check --tag v0.2.0` 和 `version.py set 0.2.0`：check 只读，set 明确同步上述产品字段并通过 cargo 锁文件更新本包；CI 只调用 check。不改 helper 协议版本。
- [ ] 实现 manifest 输入为明确 artifact report 列表、tag、source SHA、发行仓库、notes 文件和 RFC3339 时间；只枚举 report 声明的必需文件，不通过 glob 意外纳入本机产物。
- [ ] 导出 `build_manifest(version, repo, reports, notes, pub_date)` 纯函数，其最小行为断言如下；真实签名另外通过生产 verifier 校验，不把字符串检查当验签：

```python
manifest = build_manifest('0.2.0', 'runway-studio/sivio', [arm_report], '更新说明', '2026-11-02T00:00:00Z')
assert set(manifest['platforms']) == {'darwin-aarch64'}
assert manifest['platforms']['darwin-aarch64']['signature'] == sig_file.read_text().strip()
assert '/releases/download/v0.2.0/' in manifest['platforms']['darwin-aarch64']['url']
assert manifest['version'] == '0.2.0'
```

- [ ] 写 `SHA256SUMS` 与 `release-evidence.json`（source SHA、tag、平台、包名/hash、模式），逐项验证签名和源码摘要；复跑测试通过。

## Task 2: 可复现 release 构建

**Files:** 修改 `scripts/build-app.py`；新增 `scripts/release/build.py`、`scripts/release/sign.py`、`scripts/release/test_build.py`；复用 `scripts/fetch-mihomo.py`、`scripts/collect-dependency-licenses.py`；必要时修改 `scripts/validation/verify-compact-package.py`。

- [ ] 提取可导入的打包路径和命令编排函数；测试 final codesign → 可选 notarize/staple → archive → updater signature 顺序，源码内容包含 workflow 和内核清单。
- [ ] 增加显式 target、output、release config、signing mode 参数。所有 target 路径由 target/host 推导，避免旧脚本把 aarch64 当宿主的假设；保留原内部本地命令兼容。
- [ ] release 入口创建报告/缓存目录，安装 frozen pnpm 依赖，准备固定两路内核资源，再调用现有 helper/supervisor/App 构建链。构建使用项目 Rust 1.99.0、pnpm 10.13.1 与 lockfile，不执行上游源码重新拷贝脚本。
- [ ] release 签名只接收显式导入的 identity/keychain；禁止调用本机 `internal-signing.prepare()`。嵌套可执行文件先签，外层 App 最后签，所有修改在签名/归档前完成。验证 release 模式缺凭据即失败。
- [ ] 使用安装的 Tauri CLI `signer sign --help` 确认参数，通过受控环境中的私钥签最终归档；将 `.sig` 内容送生产 Rust verifier 验证。实现时不得照抄未知 CLI 选项。
- [ ] internal 模式记录未公证；只有 notarized 模式才要求 Developer ID/notary 凭据并做 staple/Gatekeeper 检查。CI keychain 和私钥临时文件设限权并在 finally 删除，报告只含公开指纹。
- [ ] 构建源码归档从固定源码树选择必要文件，增加 `.github` 和 `build/reports/upstream-manifest.json`，排除本机缓存与私钥；写 SOURCE.txt 后再签 App。
- [ ] 运行 Python 单测及 `scripts/validation/test-bundle-publication.py`；空缓存真实构建留到 Task 7，避免把 mock 当成功构建。

## Task 3: 官方更新配置与兼容

**Files:** 新增 `app/src-tauri/release-config.json`、`app/src-tauri/src/update_channel.rs`；修改 `app/src-tauri/src/lib.rs`、`settings.rs`、`app_updates.rs`、`network/mod.rs`、`commands/settings.rs`；测试置于 Rust 对应模块。

- [ ] 实现 pure resolver 前先写迁移测试：旧空→official，旧有效→custom，半配置→error，explicit disabled→disabled，autoCheckUpdate=false 不改变；保存通用设置不能覆盖 mode/source。
- [ ] release-config 保存官方 endpoint、公钥与 release page；生产 preflight 拒绝空/示例 key，开发缺配置仅显示 unavailable，不以虚构公钥占位。公钥输入到位前可用测试专用公开向量驱动测试。
- [ ] `ResolvedUpdateChannel` 包含 mode/source/configured/endpoint/publicKey/revision；`app.update.get/save` 与检查统一调用 resolver。配置持久化成功后递增 revision，清除旧候选并通知前端失效。
- [ ] check/download 用一致代理配置与 HTTPS 限制，缺 stable/不可达/禁止访问返回有区分的错误。保留自定义源校验，不把 404 当“最新”。
- [ ] 运行 `CARGO_HOME="$PWD/build/cache/cargo" cargo +1.99.0 test --manifest-path app/src-tauri/Cargo.toml --locked --lib update_channel`，确认实际匹配测试且通过；不重跑无关全量。

## Task 4: 候选绑定和安装事务

**Files:** 修改 `app/src-tauri/src/app_updates.rs`、`update_package.rs`、`commands/settings.rs`、`lib.rs`；新增 `app/src-tauri/src/update_install.rs`；必要时修改 `network/mod.rs` 的结果化清理入口。

- [ ] 为候选 registry、互斥和状态转移写测试：token 未知/过期、通道变化、重复点击、多窗口、错误版本、下载中失败、清理失败、安装失败、重启前结果。
- [ ] 新 IPC 形状：`check_app_update_info -> {candidateId,...info}`；`download_app_update(candidateId)`；`install_update_and_restart(candidateId)`；`cancel_app_update(candidateId)`。现有名称可保留，新增参数需要更新全部前端调用者。
- [ ] registry 持有真实 Tauri Update、签名公钥和 channel revision，token 随机不允许调用方提供 URL/key；下载落私有 staging 并沿用 512 MiB 上限、归档 1 GiB 解包上限、签名与包校验。
- [ ] 全局互斥按阶段拒绝重复动作；事件包含 candidateId/stage/downloaded/total，过期 UI 结果丢弃，退出或取消删除临时文件。
- [ ] 从旧 void cleanup 提取可返回错误的更新准备入口；验证包完成后才冻结配置写入并清理自有网络/网关，失败禁止调用 install。签名校验失败不触碰运行网络。
- [ ] 检查锁定 updater crate 的 macOS install 失败恢复实现；通过真实隔离 bundle 证明失败仍可启动旧版，必要时增加受控备份恢复。清理后安装失败恢复原运行意图并输出实际结果，安装成功由后端重启。
- [ ] 不自动降级数据；更新路径不写用户数据库，沿用应用启动时原有 schema 迁移/备份。错误架构、损坏包、未知签名、错误 bundle ID 测试都通过。
- [ ] 运行 `cargo +1.99.0 test --manifest-path app/src-tauri/Cargo.toml --locked --lib app_updates` 和 `... --lib update_install`（同 Task 3 的 CARGO_HOME）；真实网络/权限环境失败与逻辑失败分别记录。

## Task 5: 完整更新界面

**Files:** 修改 `app/src/components/settings/AboutSection.tsx`、`contexts/UpdateContext.tsx`、`lib/updater.ts`、`lib/api/settings.ts`、`components/DatabaseUpgrade.tsx`、`App.tsx`；新增 `app/tests/components/AppUpdate.test.tsx`；复用 `app/src/lib/unsavedChanges.ts`。

- [ ] 先写组件测试：默认官方源、显式禁用、自定义保留、无 release/网络错误、发现更新但不下载、未知 total、取消下载、确认重启、草稿拒绝、在途保存阻止、通道切换旧事件无效。
- [ ] UpdateContext 暴露阶段/candidate/progress/error，集中注册事件并正确清理；保留 autoCheckUpdate 开关与按版本忽略提示，迁移旧 cc-switch 忽略键到 Sivio 名称。
- [ ] About 展示普通用户需要的版本、更新说明、来源及下载/确认操作；endpoint/key 放高级区，移除所有发行模式统一写“内部版本”的硬编码，按实际构建模式展示。
- [ ] 下载完成后的重启确认经 App 共用未保存保护流程；取消不调用后端安装。安装时阻止新保存，后端仍有独立互斥，不单靠按钮 disabled。
- [ ] 数据库恢复页和其他安装入口迁移到相同 candidate 流程；搜索 `installUpdateAndRestart|install_update_and_restart|update-download-progress` 确保无旧调用遗留。
- [ ] 执行 `pnpm --dir app typecheck`、`pnpm --dir app exec vitest run tests/components/AppUpdate.test.tsx tests/integration/App.test.tsx tests/lib/unsavedChanges.test.tsx --maxWorkers=1 --minWorkers=1`；通过后执行一次 `pnpm --dir app build:renderer`。

## Task 6: Actions 与发行操作手册

**Files:** 新增 `.github/workflows/release.yml`、`scripts/release/publish.py`、`scripts/release/test_publish.py`、`docs/implementation/releases.md`；修改 `README.md`。

- [ ] publish 先用伪 GitHub 客户端测试：草稿可续跑、source SHA 不符失败、已发布拒绝覆盖、缺任何必需文件失败、较旧版本不得 make_latest、RC 永不 latest。
- [ ] workflow 输入仅 v* tag 或显式现存 tag，preflight 解析/验证后固定 SHA。发布并发组串行；build matrix 首批仅 aarch64 macOS runner，runner label/architecture 在实施时用 GitHub 官方文档核实。
- [ ] 为 build 安装固定 Rust/pnpm 和声明 Node 版本，按 Task 2 从空环境生成产物；缓存 key 包括 lock、target 和签名模式，不缓存私钥/临时 keychain。
- [ ] assemble 重新验证每项 report、真实归档签名、版本与源码，再把完整资产上传同一草稿。manual 触发默认保持草稿；tag 触发只有验证全部成功才发布。仓库标识使用已验证配置，不从不可信 release 文本拼 shell。
- [ ] 发布前读取当前 latest，拒绝 stable 降序；发布后匿名回读 JSON 和下载资产验签。探测失败恢复上一 latest 并标发布运行失败，首版失败明确标无可用 feed。
- [ ] 文档记录两套签名、需配置的 secrets、公钥固定、首版手动安装、后续更新、RC 边界、凭据丢失/轮换和失败恢复。更新签名私钥丢失后不能承诺原公钥客户端无感接续。
- [ ] Python tests + actionlint（若可用）+ workflow YAML 解析；本步骤成功只代表配置可审，不代表 GitHub CI 已执行。

## Task 7: 真实交付验收

**Files:** 新增 `openspec/changes/add-github-releases-and-app-updates/acceptance.md`；证据输出到 `build/reports/app-updates/`；核对并更新 tasks.md。

- [ ] 核实发行仓库/资产的匿名读取；若为私有则向用户确认公开发行位置，不修改现有可见性。核实 GitHub Actions 权限与稳定签名材料准备完毕，不读取/打印 secrets 值。
- [ ] 明确候选首版、SHA、发布说明和资产列表；在临时 runner 完成一次无缓存构建与签名/归档/源码一致性检查。验证 App 保留离线双内核与动态库依赖约束。
- [ ] 使用两版正式配置的隔离 App 实测检查→下载→确认→替换→重启→版本变化，核对配置/数据库与网络恢复；另测下载中断、错签名、只读安装路径、清理失败及安装失败。
- [ ] 若签名身份改变，单列 helper 显式修复/重新授权验收；同身份升级不应重复登记。无 Intel 真机则不加入 Intel feed。
- [ ] 发布前把版本、SHA、SHA256 和验证限制呈现给用户；本提案批准不自动等于某个尚未确定版本的正式上线指令。
- [ ] 首次上线后匿名回读实际 feed、下载验签，记录 Release URL；没有完成此步不能标“自动更新已上线”。完成项逐项勾选，未完成写 NOT_VERIFIED。

## 本轮计划校验

仅创建提案与计划，业务代码、签名身份、tag 和远程 Release 均未修改。运行 `openspec validate add-github-releases-and-app-updates --strict` 与文档链接检查；计划审查记录放在本 change 的 reviews 目录。批准后按 Task 1→2→3→4→5→6→7 顺序实施。
