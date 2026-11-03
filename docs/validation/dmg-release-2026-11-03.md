# v0.1.2 DMG 与无开发证书环境验收

日期：2026-11-03。发行提交：`7d009ce36dff552db86c590b8b490a0d77e5674b`。

## 发现与修复

原先 OSStatus 100002 场景中，运行进程对应的 App 已被删除。现补充识别当前进程文件不存在的诊断，提示退出后从 Applications 打开完整副本，而不是反复重装 helper。

[第一轮候选验证](https://github.com/runway-studio/sivio/actions/runs/41622882596) 的 DMG、复制和签名检查通过，但 helper 拒绝打包内的诊断客户端。成品中的 `si-helper-control` 签名标识变成文件名，与允许的 `local.siassist.validation` 不一致。最终签名步骤现显式设置各工具标识，并验证标识和证书指纹；未放宽 helper 信任规则。本机小型签名实验复现了错误标识被拒绝、正确标识被接受。

## 通过的验证

[完整构建及独立 consumer 作业](https://github.com/runway-studio/sivio/actions/runs/41625903298) 均成功。consumer 使用另一台 macOS 14 ARM64 运行机，没有旧版 Sivio、旧 helper、用户数据、开发证书或签名凭证：

- DMG 可只读挂载，包含 `/Applications` 快捷入口与中英安装说明；最终签名 App 的 1291 个文件在制作 DMG 前后内容和执行权限一致，签名及隐私扫描通过。
- 从 DMG 复制到 `/Applications/Sivio.app` 并卸载磁盘映像后，应用签名仍有效。
- 通过打包内的原始安装器安装 helper，显式注册此打包客户端的 CDHash，未重签客户端。
- helper 接受该客户端、启动打包内核；通过本地代理访问 HTTPS 得到 HTTP 200。
- 持续续租 35 秒，停止成功，helper 卸载退出码为 0。
- 前端定向回归 23 项及类型检查通过；Python 发布测试、真实 DMG 小型集成检查、生产更新签名验证及 OpenSpec 校验通过。

运行的 `sivio-dmg-consumer-evidence` artifact 保存了 JSON 结果。

## 发布与回读

[Sivio v0.1.2](https://github.com/runway-studio/sivio/releases/tag/v0.1.2) 使用上述成功运行的原始产物发布，主分支和标签均已推送。标签触发的重复构建 `41628658216` 主动取消，避免再次构建及并发发布；发布脚本仍验证远端标签、源码提交、更新签名、产物结构与文件摘要。

九个资产全部上传并通过匿名下载 SHA-256 回读；官方 latest 更新入口与新版本 manifest 一致。

DMG：`Sivio-0.1.2-aarch64.dmg`，43,305,943 字节。

SHA-256：`fe74b339e64c28d320c7ad94f0552961c6bd98efd3f9e000b1a2a2e2fddca649`。

## 验证边界

保留稳定内部签名，未经过 Apple 公证。干净环境的 Gatekeeper 默认评估仍拒绝（退出码 3）；用户需自行确认官方来源并在系统设置中允许首次打开。DMG 不会消除这一步。

自动化以运行机的管理员权限执行同一安装器，验证打包客户端与原生 helper 的行为；没有验证用户交互授权弹窗、完整桌面首次启动流程、TUN 或 Intel 平台，也没有关闭 Gatekeeper。此次结果不宣称所有 macOS 环境均已全面验收。
