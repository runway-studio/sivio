import { useCallback, useEffect, useRef, useState } from "react";
import { probeIdentity, useProbeInvalidation } from "./useProbeInvalidation";
import { useTranslation } from "react-i18next";
import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasPendingMutation } from "@/lib/unsavedChanges";
import { coreStatusLabel } from "@/lib/workspaceReadiness";
import { extractErrorMessage } from "@/utils/errorUtils";
import { networkApi } from "./networkApi";
import type { NetworkSnapshot } from "./networkTypes";
import { networkRecoveryNotice } from "./networkRecovery";

type Observation = {
  identity: string;
  at: number;
  ok: boolean;
  detail: string;
};

/** A target probe is evidence for this configuration, not a global health promise. */
export function NetworkHealth({
  snapshot,
  onManage,
  onSettings,
}: {
  snapshot: NetworkSnapshot;
  onManage: () => void;
  onSettings?: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const recovery = networkRecoveryNotice(snapshot, zh);
  const identity = probeIdentity(snapshot);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const epoch = useRef(0);
  const lock = useRef(false);
  const requestTimeout = useRef<ReturnType<typeof setTimeout>>();
  const [checking, setChecking] = useState(false);
  const [observation, setObservation] = useState<Observation>();
  const [expired, setExpired] = useState(false);
  const invalidate = useCallback(() => {
    clearTimeout(requestTimeout.current);
    epoch.current++;
    lock.current = false;
    setChecking(false);
    setObservation(undefined);
    setExpired(true);
  }, []);

  useEffect(() => {
    invalidate();
    return () => {
      clearTimeout(requestTimeout.current);
      epoch.current++;
      lock.current = false;
    };
  }, [identity, invalidate]);
  useProbeInvalidation(invalidate);
  useEffect(() => {
    if (!observation) return;
    const timer = window.setTimeout(invalidate, 60_000);
    return () => window.clearTimeout(timer);
  }, [observation, invalidate]);

  async function check() {
    if (
      lock.current ||
      hasPendingMutation() ||
      snapshot.runtime.recoveryRequired ||
      snapshot.appRestartRequired ||
      snapshot.runtime.phase !== "running"
    )
      return;
    lock.current = true;
    const ticket = ++epoch.current;
    const expected = identity;
    setChecking(true);
    setObservation(undefined);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        networkApi<{
          httpStatus: number;
          elapsedMs: number;
          successfulHttpResponse: boolean;
        }>("home.probe", {
          id: "apple",
          generation: snapshot.runtime.generation,
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  tr(
                    "连接检测超时，请重试",
                    "Connection check timed out; retry",
                  ),
                ),
              ),
            15_000,
          );
          requestTimeout.current = timeout;
        }),
      ]);
      if (ticket !== epoch.current || expected !== currentIdentity.current)
        return;
      setObservation({
        identity: expected,
        at: Date.now(),
        ok: result.successfulHttpResponse,
        detail: `Apple · HTTP ${result.httpStatus} · ${result.elapsedMs} ms`,
      });
      setExpired(false);
    } catch (error) {
      if (ticket !== epoch.current || expected !== currentIdentity.current)
        return;
      setObservation({
        identity: expected,
        at: Date.now(),
        ok: false,
        detail: extractErrorMessage(error),
      });
      setExpired(false);
    } finally {
      clearTimeout(timeout);
      if (ticket === epoch.current) {
        lock.current = false;
        setChecking(false);
      }
    }
  }
  const running = snapshot.runtime.phase === "running";
  const result =
    !recovery && observation?.identity === identity ? observation : undefined;
  const failed =
    !recovery?.pending &&
    (!!recovery || snapshot.runtime.phase === "failed" || result?.ok === false);
  const Icon =
    checking || recovery?.pending
      ? Loader2
      : failed
        ? AlertCircle
        : result?.ok
          ? Check
          : RefreshCw;
  return (
    <section
      className={`workspace-health ${failed ? "workspace-health-error" : result?.ok ? "workspace-health-success" : ""}`}
      aria-label={tr("网络连接状态", "Network connection status")}
    >
      <span className="workspace-health-icon">
        <Icon
          size={18}
          className={checking || recovery?.pending ? "animate-spin" : ""}
        />
      </span>
      <div className="min-w-0 flex-1" role="status">
        <p className="text-sm font-medium">
          {recovery
            ? recovery.title
            : checking
              ? tr("正在检查网络连接…", "Checking connectivity…")
              : result
                ? result.ok
                  ? tr("检测目标连接通过", "Target connectivity verified")
                  : tr("检测目标连接失败", "Target connectivity failed")
                : running
                  ? tr(
                      "网络服务运行中 · 连接待验证",
                      "Network service running · connectivity unverified",
                    )
                  : coreStatusLabel(snapshot.runtime.phase, zh)}
        </p>
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {recovery
            ? recovery.detail
            : result
              ? `${result.detail} · ${new Date(result.at).toLocaleTimeString(i18n.language)}`
              : (snapshot.runtime.error ??
                (expired && running
                  ? tr(
                      "配置或网络变化后需重新检查；模型响应单独验证。",
                      "Recheck after configuration or network changes; verify models separately.",
                    )
                  : tr(
                      "启动服务不代表目标或 AI 客户端已可用。",
                      "A running service does not verify targets or AI clients.",
                    )))}
        </p>
        {recovery && snapshot.runtime.error && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {tr("查看错误详情", "View error details")}
            </summary>
            <p className="mt-1 break-words">{snapshot.runtime.error}</p>
          </details>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {(failed || recovery) && (
          <Button
            size="sm"
            variant="outline"
            onClick={recovery || !running ? (onSettings ?? onManage) : onManage}
          >
            {recovery || !running
              ? tr("打开网络设置", "Open network settings")
              : tr("检查节点与设置", "Check nodes and settings")}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!running || checking || !!recovery}
          onClick={() => void check()}
        >
          {tr("检查连接", "Check connection")}
        </Button>
      </div>
    </section>
  );
}
