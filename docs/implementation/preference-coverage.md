# Clash Verge Rev 偏好实施映射

基线 `4337bd85758d54d7b9044b2da3c9ac1176eae1f3`；逐字段源码映射，**不是完整验收通过**。原始旧偏好可被迁移预览保留，不代表每项行为已自动映射。

源码接入：73 项已接入待完整验收，2 项 macOS 不适用。此计数不代表 UI、权限、迁移或故障矩阵已经通过。helper 9 新能力须完成独立安装与运行验证。

| 字段 | 当前状态 | 说明 |
| --- | --- | --- |
| `app_log_level` | implemented-awaiting-full-acceptance | 全宿主日志过滤器；独立 helper 审计日志保持独立策略 |
| `app_log_max_size` | implemented-awaiting-full-acceptance | 单文件 1–20 MiB；当前文件加归档总计最多 80 MiB，重启生效；只读非秘密 bootstrap，不触发 Keychain |
| `app_log_max_count` | implemented-awaiting-full-acceptance | 归档 1–8 份，与文件大小联合限制总量，重启生效 |
| `language` | implemented-awaiting-full-acceptance | 保留五种基线语言，网络关键流程提供中英文 |
| `theme_mode` | implemented-awaiting-full-acceptance | 系统/浅色/深色 |
| `tray_event` | implemented-awaiting-full-acceptance | 左键菜单/显示窗口 |
| `env_type` | implemented-awaiting-full-acceptance | 五种终端格式；复制使用本 App 实际运行端口；停止时明确拒绝 |
| `start_page` | implemented-awaiting-full-acceptance | 记住页面或显式启动页；不覆盖已发生导航 |
| `startup_script` | implemented-awaiting-full-acceptance | 原生选取 .sh/.ps1 后单独本机授权；校验内容摘要；变更需重新授权；后台执行上限 30 秒，不随数据库/配置包恢复自动授权 |
| `traffic_graph` | implemented-awaiting-full-acceptance | 流量曲线开关已接通 |
| `enable_memory_usage` | implemented-awaiting-full-acceptance | 内核内存卡片开关已接通 |
| `enable_group_icon` | implemented-awaiting-full-acceptance | 代理组图标开关；HTTPS 图标不携带 referrer |
| `pause_render_traffic_stats_on_blur` | implemented-awaiting-full-acceptance | 原生失焦同步查询 focusManager；流量采样可单独选择后台继续 |
| `common_tray_icon` | implemented-awaiting-full-acceptance | 常规/代理/TUN 三槽图片上传、清除、独立启用；关闭保留图片；模板/彩色 |
| `tray_icon` | implemented-awaiting-full-acceptance | 常规图标上传及启用；有界 PNG 解码，模板/彩色 |
| `menu_icon` | implemented-awaiting-full-acceptance | 单色/主题色/隐藏；收起导航仍保留图标 |
| `menu_order` | implemented-awaiting-full-acceptance | 全局导航顺序可调整；新增页面自动追加不丢入口 |
| `proxy_group_tools_position` | implemented-awaiting-full-acceptance | 分组测速工具左/右位置可选 |
| `notice_position` | implemented-awaiting-full-acceptance | 六种通知位置 |
| `collapse_navbar` | implemented-awaiting-full-acceptance | 收起/展开侧栏 |
| `sysproxy_tray_icon` | implemented-awaiting-full-acceptance | 系统代理启用时切换图标，独立开关保留图片 |
| `tun_tray_icon` | implemented-awaiting-full-acceptance | TUN 图标优先；独立开关保留图片 |
| `enable_tun_mode` | implemented-awaiting-full-acceptance | 显式 TUN 开关；revision 8 已真机验证 |
| `enable_auto_launch` | implemented-awaiting-full-acceptance | 独立 App 开机自启 |
| `enable_silent_start` | implemented-awaiting-full-acceptance | 静默启动 |
| `enable_system_proxy` | implemented-awaiting-full-acceptance | 独立服务快照/CAS恢复 |
| `enable_proxy_guard` | implemented-awaiting-full-acceptance | 可启停；运行时缓存设置；外部接管/CAS 拒绝后本轮永久停止，不重新抢占 |
| `enable_bypass_check` | implemented-awaiting-full-acceptance | 语法检查可关闭；长度/NUL 硬边界不可关闭 |
| `enable_dns_settings` | implemented-awaiting-full-acceptance | DNS YAML 的 enable 字段，可编辑/校验/预览 |
| `profile_dns_settings` | implemented-awaiting-full-acceptance | 逐订阅继承/原订阅/自定义 DNS |
| `use_default_bypass` | implemented-awaiting-full-acceptance | 默认/自定义切换；关闭默认后保留并恢复自定义值 |
| `system_proxy_bypass` | implemented-awaiting-full-acceptance | 绕过列表 |
| `proxy_guard_duration` | implemented-awaiting-full-acceptance | 1–3600 秒；异步检查与 3 秒 RPC 上限 |
| `proxy_auto_config` | implemented-awaiting-full-acceptance | 系统代理 global/PAC 选择 |
| `pac_file_content` | implemented-awaiting-full-acceptance | 本地 PAC 服务和受限脚本 |
| `proxy_host` | implemented-awaiting-full-acceptance | 校验显式 hostname/IP；非本机目标启动前原生确认；helper 9 支持；真实系统代理验收待执行 |
| `theme_setting` | implemented-awaiting-full-acceptance | 字体/颜色/字号/受限 CSS 与恢复 |
| `web_ui_list` | implemented-awaiting-full-acceptance | 至多 20 个 HTTPS/本机 HTTP 控制面板；明确来源 allowlist；打开 URL 不含凭据 |
| `clash_core` | implemented-awaiting-full-acceptance | 固定 stable/Alpha 选择 |
| `hotkeys` | implemented-awaiting-full-acceptance | 十种动作，验证加修饰键/重复/冲突回滚 |
| `enable_global_hotkey` | implemented-awaiting-full-acceptance | 默认关闭；关闭释放按键 |
| `home_cards` | implemented-awaiting-full-acceptance | 四张概览统计卡片可逐项启停 |
| `auto_close_connection` | implemented-awaiting-full-acceptance | 节点选择持久化后可选关闭连接 |
| `auto_check_update` | implemented-awaiting-full-acceptance | 可关闭启动检查，手动检查保留；真实自有通道仍未配置 |
| `default_latency_test` | implemented-awaiting-full-acceptance | 默认测速 URL |
| `default_latency_timeout` | implemented-awaiting-full-acceptance | 100–5000 ms |
| `enable_auto_delay_detection` | implemented-awaiting-full-acceptance | 间隔 0 关闭 |
| `auto_delay_detection_interval_minutes` | implemented-awaiting-full-acceptance | 有界分组测速，组间释放运行锁 |
| `enable_builtin_enhanced` | implemented-awaiting-full-acceptance | 固定基线两个兼容增强均可关闭；GUI 和 root 权限约束不可关闭 |
| `proxy_layout_column` | implemented-awaiting-full-acceptance | 1–6 列；60 节点分页，1000 节点全部可访问且搜索覆盖全部 |
| `test_list` | implemented-awaiting-full-acceptance | 自定义测试名称/URL/图标 CRUD；请求使用本 App 运行网络，失败不直连 |
| `auto_log_clean` | implemented-awaiting-full-acceptance | 应用日志 0/1/7/30/90 天清理；默认 7 天；仅本 App 普通文件，不跟随链接；活动文件下次启动清理 |
| `enable_auto_backup_schedule` | implemented-awaiting-full-acceptance | 间隔 0 关闭 |
| `auto_backup_interval_hours` | implemented-awaiting-full-acceptance | 本地数据库快照定期备份，手动完整配置包另有入口 |
| `auto_backup_on_change` | implemented-awaiting-full-acceptance | 配置表变更去抖并生成一致性本机 SQLite 快照；不由用量/健康日志触发，最短间隔 60 秒，结果可见；完整 Skills 配置包另有手动入口 |
| `verge_redir_port` | implemented-awaiting-full-acceptance | Redir TCP 端口 |
| `verge_redir_enabled` | implemented-awaiting-full-acceptance | 端口 0 关闭 |
| `verge_tproxy_port` | not-applicable-macos | Linux TProxy；固定上游 macOS 不支持 |
| `verge_tproxy_enabled` | not-applicable-macos | Linux TProxy；固定上游 macOS 不支持 |
| `verge_mixed_port` | implemented-awaiting-full-acceptance | 独立不冲突端口 |
| `verge_socks_port` | implemented-awaiting-full-acceptance | SOCKS 端口 |
| `verge_socks_enabled` | implemented-awaiting-full-acceptance | 端口 0 关闭 |
| `verge_port` | implemented-awaiting-full-acceptance | HTTP 端口 |
| `verge_http_enabled` | implemented-awaiting-full-acceptance | 端口 0 关闭 |
| `webdav_url` | implemented-awaiting-full-acceptance | 复用唯一配置同步接口 |
| `webdav_username` | implemented-awaiting-full-acceptance | Keychain 持久化 |
| `webdav_password` | implemented-awaiting-full-acceptance | Keychain 持久化 |
| `enable_tray_speed` | implemented-awaiting-full-acceptance | 可启停菜单栏流量速率；有界采样，不在 AppKit 解密 |
| `tray_proxy_groups_display_mode` | implemented-awaiting-full-acceptance | default/inline/disable；节点操作绑定 generation 和目录修订 |
| `tray_inline_outbound_modes` | implemented-awaiting-full-acceptance | 模式内联/子菜单两种布局 |
| `enable_auto_light_weight_mode` | implemented-awaiting-full-acceptance | 0 关闭；失焦计时且 renderer 确认无草稿/进行中操作 |
| `auto_light_weight_minutes` | implemented-awaiting-full-acceptance | 0–1440 分钟 |
| `enable_hover_jump_navigator` | implemented-awaiting-full-acceptance | 代理组导航悬停/点击定位；离开或销毁取消定时器 |
| `hover_jump_navigator_delay` | implemented-awaiting-full-acceptance | 悬停延迟 0–5000 毫秒；禁用仍可点击定位 |
| `enable_external_controller` | implemented-awaiting-full-acceptance | 显式启用 loopback 认证桥；HTTP/四种 WebSocket 流；固定操作白名单，根内核仍 Unix 私有控制；真实 dashboard 对接待验收 |
