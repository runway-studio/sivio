# SI Assist Logo · 汇流

用户已确认「汇流」方向。以双曲线 S 和右上圆点构成标志；本轮按已确认图形重绘为纯矢量路径，清理边缘并将色值固定为 #7055D8 / #9D87E8。矢量轮廓经过平滑，不是对生成 PNG 的逐像素复制。已替换设计稿侧栏、favicon 和 Logo 展示页，更新界面预览。

## 文件

| 文件 | 使用方式 |
| --- | --- |
| [si-assist-mark.svg](si-assist-mark.svg) | 透明底矢量母版，两个 path 和一个 circle，可独立编辑；无嵌入位图、字体、脚本或外部资源 |
| [si-assist-app-icon.svg](si-assist-app-icon.svg) | 应用图标母版，含白色圆角底板与透明外边距 |
| [si-assist-mark-1024.png](si-assist-mark-1024.png) | 从矢量导出的 1024×1024 透明 Logo |
| [si-assist-app-icon-1024.png](si-assist-app-icon-1024.png) | 1024×1024 应用图标预览/源图 |
| [SI Assist.icns](SI%20Assist.icns) | macOS 应用图标容器，可供后续 Tauri/macOS 打包引用 |
| [SI Assist.iconset](SI%20Assist.iconset/) | 标准 iconset，10 个 PNG 文件 |
| [AppIcon.appiconset/Contents.json](AppIcon.appiconset/Contents.json) | Xcode 图标资源及元数据，整个目录复制进 asset catalog 使用 |
| [export-icons.sh](export-icons.sh) | 从 SVG 重建 PNG、iconset、appiconset 与 ICNS |
| [index.html](index.html) / [presentation.png](presentation.png) | 浅色、深色、应用图标和小尺寸展示 |
| [asset-validation.json](asset-validation.json) | 文件结构、尺寸与 ICNS 重新解包核验记录 |
| [si-assist-mark-v1.png](si-assist-mark-v1.png) | 已确认的原始生成概念稿，仅存档，不作为新导出的来源 |
| [generation-prompt.md](generation-prompt.md) | 原始 image_gen 提示词与精修记录 |

## macOS 尺寸

iconset 和 appiconset 均包括 16、32、128、256、512 pt 的 1x / 2x 共 10 个槽位，实际像素为 16–1024。分别由矢量直接栅格化，不放大低分辨率位图。`.icns` 由 macOS 原生 `iconutil` 打包，并重新解包核对。依据 [Apple Icon Set Type](https://developer.apple.com/library/archive/documentation/Xcode/Reference/xcode_ref-Asset_Catalog_Format/IconSetType.html) 与 [Apple 高分辨率图标指南](https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Optimizing/Optimizing.html)。

## 复现与边界

在安装 librsvg 且提供 `iconutil` 的 macOS 环境运行 `bash export-icons.sh`。母版内含稳定的 shape id，后续可在矢量编辑器中调整。小尺寸保持同一已确认轮廓；已检查预览可辨识，最终应用集成时仍需验证实际 Dock / Finder 中的显示。图标文件不是应用包，本轮没有创建应用代码或修改 Tauri 配置，不包含 Icon Composer `.icon` 或菜单栏单色模板。
