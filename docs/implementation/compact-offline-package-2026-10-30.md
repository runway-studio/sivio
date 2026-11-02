# 约 80 MB 的离线完整 App

用户批准的两步：精确对应源码独立交付，双 Mihomo 内核合并无损压缩。目标针对 `.app` 本体（80,000,000 字节以内），源码包和首次启动后生成的运行时内核缓存另计。

## 包格式与运行时

`network/mihomo-cores.xz` 是一个 XZ 流，使用 64 MiB 字典。解码后的头部为 `SIVCORE1`、稳定内核和 Alpha 内核各自的 64 位小端字节长度，后接两个原始完整可执行文件。两个文件内容不修改、不打补丁，仍分别匹配原固定 SHA256；构建阶段同时核对原下载压缩包与二进制摘要。

运行时使用静态编入 App 的 liblzma Rust 接口，无需 Homebrew、命令行 xz 或外部下载。显式启用 xz2 的 static feature，避免构建机的 pkg-config 意外引入 Homebrew 动态依赖；最终检查 Mach-O 动态库路径。解码器内存上限 128 MiB，每个内核输出上限 256 MiB，使用 64 KiB 缓冲区流式写入私有临时文件。格式、尺寸、两个摘要和压缩流校验和均通过后才原子发布文件，权限为 0700。失败解包自动清理暂存文件；已有有效内核保留原 inode，不替换可能正在运行的程序。

有效缓存直接复用。首次安装、缓存丢失、内容损坏、所有者执行权限缺失时，均从 App 内归档恢复，不联网。网络服务安装流程仍可取得两个内核，原固定摘要与 helper 协议不变。

## 源码与许可

构建产出独立 `Sivio-<version>-source-<hash>.tar.gz`，与 App/ZIP 放在相同交付目录。App 的 `Resources/legal/SOURCE.txt` 记录精确文件名及完整 SHA256。原许可证、第三方依赖通知与源码清单继续保留，重新分发时需同时提供对应源码访问。源码不属于运行依赖，未将任何业务资源改成按需下载。

## 验证

- 网络回归与解包单元测试 89 通过、0 失败；4 个专项用例默认忽略，其中下面两项已单独执行通过：`build/reports/app-size-80/native-tests.log`。
- 真实双内核通过生产解包代码离线恢复，并修复损坏缓存（通过）：`build/reports/app-size-80/real-cores.log`。
- 真实内核热应用/失败回滚代理流量验证（通过）：`build/reports/app-size-80/live-apply.log`。
- 新旧 App 发布隔离测试：`build/reports/app-size-80/publication-tests.log`。
- 最终 `scripts/validation/verify-compact-package.py` 验证体积门槛、源码摘要与文件对应、前端及功能资源保留、双内核 SHA256、原目录与 ZIP 解压后的签名、签名身份保持一致、双内核离线沙箱启动、真实本地 HTTP 代理转发、关闭后回收。
- 最终产物和实测数据：`build/reports/app-size-80/verified.json`。测试只使用临时目录与本地端口，不修改系统代理或用户订阅。

## 验收时发现并修复的环境问题

首轮依赖路径检查发现 pkg-config 链接了 Homebrew liblzma，已改为静态链接，并在打包前拒绝非系统/非包内动态库路径。静态版本的解包与网络回归通过。原热更新集成测试使用 debug supervisor 与约六秒等待，在本机负载下启动超时；对比诊断确认 release supervisor 能成功启动，因此测试改为使用实际交付的 supervisor，并设置 30 秒就绪期限及提前退出日志。该调整仅影响测试，不改变产品运行时超时策略。失败日志与对比记录保留在 build/reports/app-size-80/。
