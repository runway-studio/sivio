import type { NetworkSnapshot } from "./networkTypes";

/** Recovery facts come from the native runtime, never from parsing error text. */
export function networkRecoveryNotice(snapshot: NetworkSnapshot, zh: boolean) {
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const runtime = snapshot.runtime;
  if (snapshot.appRestartRequired)
    return {
      title: tr("需要重新打开 Sivio", "Reopen Sivio to continue"),
      detail: tr(
        "应用文件已更新，请退出并打开新版，再检查网络服务。",
        "App files changed. Quit and open the updated app, then check the network service.",
      ),
      pending: false,
    };
  if (runtime.recoveryRequired)
    return {
      title: tr("网络清理尚未完成", "Network cleanup incomplete"),
      detail: tr(
        "请先使用左侧停止按钮重试清理，完成后再启动；失败时可进入网络设置处理。",
        "Retry cleanup with Stop in the sidebar before starting again. Open network settings if it fails.",
      ),
      pending: false,
    };
  if (
    runtime.phase === "failed" &&
    runtime.recoveryStatus === "waiting_for_network"
  )
    return {
      title: tr("等待网络恢复", "Waiting for a network"),
      detail: tr(
        "尚无可用的系统网络服务；连接 Wi-Fi 或有线网络后将继续重连，也可从左侧停止。",
        "No active system network service. Reconnection resumes when Wi-Fi or Ethernet is available; Stop in the sidebar cancels it.",
      ),
      pending: true,
    };
  if (runtime.phase === "failed" && runtime.recoveryStatus === "retrying")
    return {
      title: tr("正在恢复网络连接", "Recovering the network connection"),
      detail: tr(
        "正在重试连接网络服务；恢复后仍需检查目标连通性。左侧停止按钮可取消恢复。",
        "Retrying the network service. Check target connectivity after recovery. Stop in the sidebar cancels recovery.",
      ),
      pending: true,
    };
  if (runtime.phase === "running" && runtime.proxyGuardInspectionUnavailable)
    return {
      title: tr("暂时无法核对系统代理", "System proxy status unavailable"),
      detail: tr(
        "正在重新读取系统设置，读取成功后会更新代理状态。",
        "Retrying the system settings check. Proxy status will update when the settings can be read.",
      ),
      pending: true,
    };
  if (runtime.phase === "running" && runtime.proxyGuardWaitingForNetwork)
    return {
      title: tr("等待系统网络服务", "Waiting for a system network service"),
      detail: tr(
        "暂时无法获取可核对的系统网络服务；恢复后会自动重新检查代理，不会覆盖其他工具的设置。",
        "A system network service is temporarily unavailable for inspection. The proxy will be checked again when it becomes available, without overwriting another tool's settings.",
      ),
      pending: true,
    };
  if (runtime.proxyGuardTripped)
    return {
      title: tr("系统代理已被外部修改", "System proxy changed externally"),
      detail: tr(
        "Sivio 已暂停接管系统代理，保留外部设置。请在网络设置中确认当前连接方式。",
        "Sivio has suspended system proxy ownership and preserved external settings. Review the connection in network settings.",
      ),
      pending: false,
    };
  return undefined;
}
