# Change: 保留离线能力的约 80 MB App 交付

## Why
现有 release App 约 159.5 MiB；用户明确批准将源码独立交付并合并压缩双内核，要求不减少功能、保留离线使用并测试重打包。

## What Changes
- 对应源码以带摘要的独立文件与 App 在同一位置交付，App 内保留许可和精确来源说明。
- 稳定与 Alpha 内核使用一个 XZ 字典无损压缩，首次解包和缓存恢复完全离线。
- 校验格式、大小、解码资源限制、XZ 校验和及两个已固定内核的 SHA256，再原子发布缓存；有效缓存不替换。
- 发布构建仍保留所有功能、辅助程序和同一签名身份；目标 App 本体不超过 80,000,000 字节。

## Impact
- Affected specs: network-proxy
- Affected code: network/core_bundle.rs、network/mod.rs、scripts/build-app.py、包验证脚本。
- 用户已在本次会话明确批准上述两步，无需再次审批。运行时缓存与独立源码包不计入 App 本体目标。
