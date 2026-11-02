## Context

基线为 `f67e919`。现有 `app_updates.rs` 从用户设置获取 endpoint/key，用 Tauri 比较版本，独立下载并校验 minisign；`update_package.rs` 校验路径、包大小、bundle ID、版本、架构和 macOS 签名。About 页面要求手填源；安装命令重新检查最新版本，且 macOS 分支先原地替换再清理网络。`scripts/build-app.py` 在 Tauri 构建后再次签名并生成归档，因此不能直接上传 Tauri 中间输出的签名包。

发布侧无 `.github/workflows`。固定内核资产清单 `build/reports/upstream-manifest.json` 已被 Git 跟踪，源码已在 `vendor/upstream`，但内核下载缓存、资源和签名身份均是本机生成物。CI 必须从空缓存复现，不能只上传当前机器 dist。

## Goals / Non-Goals

- 首个可复现 Release 与其后的 N→N+1 真实升级，配置、数据库和自有网络恢复均有证据。
- 单 stable 通道；RC 为预发布手动下载。暂不做 beta 自动更新、差分包、Windows/Linux、自动降级或镜像服务。
- 保留 ZIP 首装形式；更新使用完整 `.app.tar.gz`。不为对齐上游外观额外引入 DMG。

## Decisions

### 1. 版本与发布事务

产品版本以 `app/src-tauri/tauri.conf.json` 为源；辅助命令同步 `app/package.json`、`app/src-tauri/Cargo.toml` 和 Cargo.lock 的本包版本。独立 helper/supervisor 协议版本不跟随 App 机械修改。CI 要求 tag `v<SemVer>` 与这四处一致，源 SHA 固定；不得在构建中默默改版本。

`vX.Y.Z` 生成 stable 候选，`vX.Y.Z-rc.N` 生成 prerelease，其他 tag 拒绝。手动触发仅构建指定已存在 tag 并生成草稿。tag 工作流通过全部门槛后可发布；已发布 tag/资产不可覆盖，重跑仅复用同 SHA 的草稿。发行任务串行，防止较旧版本的迟到任务取代 latest；stable 发布前与当前 latest 做 SemVer 比较。

工作流分 preflight、build、assemble、publish。build 只需 contents:read；仅 publish 有 contents:write。不要沿用上游 write-all。第三方 actions 使用实施时核实的 commit SHA。不要把 secrets 暴露给 PR/fork 构建。

### 2. 资产与清单

在 `runway-studio/sivio` 可匿名读取发行资产的前提下，内置 feed 为 `https://github.com/runway-studio/sivio/releases/latest/download/latest.json`，发行页指向该仓库 Releases。若不可匿名读取，在上线前确定发行仓库并同时更新构建常量及文档；不擅自公开仓库。

每个 stable release 必须含所有支持平台的完整项，首批仅 `darwin-aarch64`；Intel 没有验收则不出现。清单形式：

```json
{
  "version": "0.2.0",
  "notes": "本版发行说明",
  "pub_date": "2026-11-02T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://github.com/runway-studio/sivio/releases/download/v0.2.0/Sivio-0.2.0-aarch64.app.tar.gz",
      "signature": "生成的 .sig 文件原始文本内容"
    }
  }
}
```

示例不是可发布资产，版本仅为说明。生成器必须读取真实 `.sig`，不能填签名 URL 或示例值。对每项校验归档、签名、公钥、版本、架构和 SHA256。发布前核对草稿资产列表与本地 manifest/摘要完全对应。匿名读取只能在草稿发布后验证，失败时将该版撤出 latest 并恢复上一 stable 选择；首版无上一版则保留明确不可用状态并停止后续推广。

RC 设置 prerelease=true、make_latest=false，不提供可被 stable 端点选中的发行记录。所有已发布资产保留不可变下载 URL。

### 3. 构建与两种签名

本地内部构建路径仍可用；新增 release 模式必须显式提供发行公钥和稳定 macOS 身份，缺失时失败，不能生成随机身份或退化为 ad-hoc。先固定依赖/内核缓存与通知，再构建并完成 App 内所有资源修改，之后从内到外签名，最后归档并进行 Tauri 签名。保持受限内核压缩格式和资源完整性。

Tauri 更新签名与 macOS codesign 是两套独立身份：前者验证下载来源，后者维持系统/特权服务认可的 App 身份。公钥可跟踪，私钥只由持有人安全保存并配置 CI secret。不在聊天或日志输出私钥。CI 使用短期 keychain，任务结束清理，不运行会修改用户 keychain 搜索列表的本地 `prepare()`。

默认 internal 模式导入同一稳定证书，不每次重新生成；ZIP/发行说明明确未公证。若用户选择 Developer ID，则增加嵌套签名、notarytool、staple 与 Gatekeeper 校验，最终 staple 后再归档/签 updater。身份变化可能需要一次显式 helper 重新授权，不能绕过当前证书绑定，也不能宣称自动无感迁移。没有 Apple 凭据不影响 internal 模式的实现。

源码包须匹配 tag/SHA，包含实际应用/native/vendor、锁文件、构建脚本、发布工作流和使用的公共构建配置；排除缓存、资源产物、用户数据、私钥。App 内 SOURCE.txt 引用精确源码文件名和摘要。现有 source 打包选择需补 `.github`、`app/rust-toolchain.toml`（随 app 已包含）以及固定内核资产清单；禁止依赖被排除的本机缓存才能重建。

### 4. 官方默认源与兼容

统一后端 resolver 输出 `mode`、`source`、`configured`、`endpoint`、`publicKey`。新增可选设置 `update_channel_mode`（official/custom/disabled）。迁移：未设置 mode 且旧两项为空 → official；旧两项均有效 → custom；仅一项存在 → 配置错误，不偷偷切官方。新 explicit disabled 永远禁用。旧空值不能区分从未配置和历史手动清空：首次引导说明此兼容取舍，仍尊重 autoCheckUpdate=false；用户可显式禁用。

官方 endpoint/key 从同一发行配置读取，生产发布不允许空或占位公钥。普通界面显示版本、官方来源和发行说明链接，自定义输入移到高级区域。保留已有自定义源的 HTTPS 和签名规则，禁止默认使用上游公钥。配置变更立即清空已有 updateInfo/下载状态并递增通道 revision，迟到结果丢弃；检查与下载采用同一显式代理配置，不改变系统代理。

### 5. 更新生命周期

状态为 idle/checking/available/downloading/verifying/ready/installing/restarting/error。被动检查遵守 autoCheckUpdate，单进程去重；没有 stable、网络失败、未配置/禁用和“已是最新”分开呈现。

检查返回由后端保存的候选 token，绑定 version、URL、signature、channel revision 和当前版本。下载只接受该 token；过期或通道变更需重新检查，不因 latest 在过程中改变而安装另一版。后端全局互斥保护下载和安装，前端传入版本不足以替代后端约束。

先完整下载、验签及包校验并保留私有 staging；用户确认后、安装前再次检查草稿/在途写操作，并提示网络短暂中断。下载期间网络照常工作。准备安装时串行停止新配置写入，调用可报告成功/失败的自有网络/网关清理；失败不替换 App，不允许沿用只记录日志的 void cleanup 当作成功。

macOS 替换必须发生在验证与清理之后，避免先替换正在使用的资源再做清理。检查锁定的 updater 2.10.0 源码后发现其 macOS 安装失败路径不能保证恢复原包，因此保留 Tauri 检查与共享验签，使用同卷暂存、rename 与失败恢复实现替换：旧包保留于 `.sivio-update-*/previous.app`，新包移动失败则恢复旧位置。替换成功由后端重启，不依赖旧 WebView。安装失败释放锁并尝试按保存意图恢复自有网络；失败信息要求到网络页检查恢复情况。App 用户数据不属于替换目标，数据库迁移仍走既有备份机制，不新增自动数据降级。原生 N→N+1 仍需独立验收，不能用文件系统测试替代。

现有 `DatabaseUpgrade` 等所有更新入口都适配新候选/安装协议，防止遗漏一个直接安装调用路径。进度使用后端事件，未知 total 显示已下载量而不是伪造百分比；取消下载清理 staging，安装阶段不提供误导性的取消按钮。

### 6. 首次上线与验收

旧 0.1.0 使用手动安装作为首选引导，不要求普通用户手工输公钥。首个正式包具备默认 feed；之后用两个独立版本和隔离用户目录完成真实升级。旧自签名 → 新发行身份的 helper 修复单独验收；同身份后续升级应无需重新登记。

实际证据分：脚本/组件/后端自动化、干净 runner 构建、真实签名包验收、已发布匿名 URL/下载验签、原生 N→N+1。任何未执行项目标 NOT_VERIFIED；不将 120 项旧前端通过记录算本功能验收。

## Remaining external inputs

- 2026-11-02 用户已确认首批 Apple Silicon、稳定内部签名并保留首次安装提示；这两项不再是待确认输入。
- 用户于 2026-11-02 明确授权将仓库公开，并授权将现有两套签名身份存入该仓库的 Actions Secrets。仓库公开状态已回读；CI 与发行资产匿名验证分别记录验收证据。
- 确定首发版本与中文发行说明后才能创建真实 tag。发布前展示具体版本、SHA、资产摘要、签名模式和未验证范围。
