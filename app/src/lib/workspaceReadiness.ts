/** Evidence describes an observation, never a promise of future availability. */
export type ReadinessState =
  | "unknown"
  | "pending"
  | "pass"
  | "fail"
  | "unsupported"
  | "stale";
export interface ReadinessIdentity {
  app: string;
  configurationRevision: string;
  credentialEpoch: string;
  networkGeneration: number;
  outboundRevision: string;
}
export interface ModelVerification {
  identity: ReadinessIdentity;
  observedAt: number;
  state: "pass" | "fail";
  reasonCode: string;
}
export type ReadinessCheckId =
  | "configuration"
  | "client_read"
  | "gateway"
  | "outbound"
  | "model";
export interface ReadinessCheck {
  id: ReadinessCheckId;
  state: ReadinessState;
  reasonCode: string;
  actionId: "manage_providers" | "manage_network" | null;
}
export interface DiagnosticRun {
  runId: string;
  app: string;
  providerId: string;
  model: string;
  identity: ReadinessIdentity;
  observedAt: number;
  state: ReadinessState;
  reasonCode: string;
  purpose: "diagnostic";
  budgetEnforcement: "not_enabled";
  costStatus: "unknown";
}
export interface ReadinessSnapshot extends ReadinessIdentity {
  diagnostic?: DiagnosticRun | null;
  observedAt: number;
  checks: ReadinessCheck[];
}

const reasonLabels: Record<string, [string, string]> = {
  model_verified: ["模型响应已验证", "Model response verified"],
  diagnostic_pending: ["正在验证模型响应", "Verifying model response"],
  diagnostic_stale: [
    "配置已变化或验证过期，请重新验证",
    "Configuration changed or verification expired; verify again",
  ],
  diagnostic_failed: ["模型验证失败", "Model verification failed"],
  diagnostic_cancelled: ["已取消诊断", "Diagnostic cancelled"],
  diagnostic_timeout: ["诊断超过30秒", "Diagnostic exceeded 30 seconds"],
  diagnostic_busy: [
    "该客户端已有诊断运行",
    "A diagnostic is already running for this client",
  ],
  authentication_failed: [
    "鉴权失败（401/403）",
    "Authentication failed (401/403)",
  ],
  rate_limited: ["供应商限流（429）", "Provider rate limited (429)"],
  upstream_failed: ["供应商服务失败（5xx）", "Provider service failed (5xx)"],
  upstream_rejected: [
    "供应商拒绝请求，请检查模型和协议",
    "Provider rejected the request; check model and protocol",
  ],
  credential_verification_unsupported: [
    "此凭据需在客户端手动验证",
    "Verify these credentials manually in the client",
  ],
  credentials_missing: ["缺少凭据", "Credentials missing"],
  credentials_invalid: ["凭据格式无效", "Invalid credential format"],
  provider_missing: [
    "供应商已删除，请重新选择",
    "Provider removed; select again",
  ],
  endpoint_invalid: ["供应商地址无效", "Invalid provider endpoint"],
  invalid_model: ["模型 ID 无效", "Invalid model ID"],
  outbound_failed: ["出站连接失败", "Outbound connection failed"],
  no_valid_model_response: [
    "未收到有效模型文本和完成信号",
    "No valid model text and completion signal",
  ],
  invalid_response: ["响应协议无效", "Invalid response protocol"],
  response_interrupted: ["响应中断", "Response interrupted"],
  response_too_large: [
    "诊断响应超出大小限制",
    "Diagnostic response exceeded size limit",
  ],
  upstream_error: ["模型响应包含错误", "Model response contained an error"],
  configuration_saved: ["配置已保存", "Configuration saved"],
  configuration_missing: ["尚无供应商配置", "No provider configuration"],
  client_reload_unobserved: [
    "尚未观测到客户端读取",
    "Client reload not observed",
  ],
  listener_running: ["监听服务运行中", "Listener running"],
  listener_stopped: ["监听服务已停止", "Listener stopped"],
  gateway_not_required: [
    "直连模式无需网关",
    "Gateway not required in direct mode",
  ],
  gateway_unsupported: [
    "此客户端不支持本地网关",
    "Local gateway not supported",
  ],
  managed_outbound_unavailable: [
    "受管出口不可用",
    "Managed outbound unavailable",
  ],
  managed_outbound_unverified: [
    "受管出口待验证",
    "Managed outbound unverified",
  ],
  custom_outbound_unverified: [
    "自定义出口待验证",
    "Custom outbound unverified",
  ],
  direct_outbound_unverified: ["直连出口待验证", "Direct outbound unverified"],
  outbound_unavailable: ["出口状态不可用", "Outbound state unavailable"],
  client_outbound_unobserved: [
    "客户端出口不由网关观测",
    "Client outbound not observed by gateway",
  ],
  model_unverified: ["尚未验证模型响应", "Model response not verified"],
  model_verification_unsupported: [
    "请在客户端手动验证",
    "Verify manually in the client",
  ],
};
export function readinessReasonLabel(reason: string, zh: boolean): string {
  return (
    reasonLabels[reason]?.[zh ? 0 : 1] ?? (zh ? "状态待确认" : "Status unknown")
  );
}
export const VERIFICATION_TTL_MS = 10 * 60 * 1000;

/** Call at read time: configuration changes invalidate both success and failure. */
export function verificationState(
  evidence: ModelVerification | undefined,
  current: ReadinessIdentity,
  now = Date.now(),
): ReadinessState {
  if (!evidence) return "unknown";
  if (
    !Number.isFinite(evidence.observedAt) ||
    now < evidence.observedAt ||
    now - evidence.observedAt >= VERIFICATION_TTL_MS ||
    (Object.keys(current) as (keyof ReadinessIdentity)[]).some(
      (key) => current[key] !== evidence.identity[key],
    )
  )
    return "stale";
  return evidence.state;
}

/** Process state is deliberately independent of outbound/model reachability. */
export function coreStatusLabel(
  phase: string | undefined,
  zh: boolean,
  unavailable = false,
): string {
  if (unavailable) return zh ? "状态不可用" : "Status unavailable";
  const labels: Record<string, [string, string]> = {
    running: ["运行中", "Running"],
    stopped: ["已停止", "Stopped"],
    idle: ["已停止", "Stopped"],
    starting: ["启动中", "Starting"],
    stopping: ["停止中", "Stopping"],
    failed: ["运行失败", "Failed"],
  };
  return (
    labels[phase ?? ""]?.[zh ? 0 : 1] ?? (zh ? "状态待确认" : "Status unknown")
  );
}
