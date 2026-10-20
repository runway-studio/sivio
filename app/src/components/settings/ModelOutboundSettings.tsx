import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  networkApi,
  type NetworkSnapshot,
} from "@/components/network/NetworkWorkspace";
import { useNetworkText } from "@/components/network/networkText";
import { usePendingMutation, useUnsavedValue } from "@/lib/unsavedChanges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ModelOutboundSettings() {
  const tr = useNetworkText();
  const client = useQueryClient();
  const snapshot = useQuery({
    queryKey: ["network", "snapshot"],
    queryFn: () => networkApi<NetworkSnapshot>("snapshot"),
  });
  const [mode, setMode] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saved = snapshot.data?.catalog.outbound;
  const selected = mode ?? saved ?? "direct";
  const dirty = (mode !== null && mode !== saved) || !!url;
  useUnsavedValue(dirty);
  usePendingMutation(busy);
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h3 className="font-medium">{tr("AI 出站策略")}</h3>
      <p className="text-xs text-muted-foreground">
        {tr(
          "此设置仅影响模型请求；Clash 端口、DNS 和系统代理在网络设置中独立配置。",
        )}
      </p>
      {snapshot.error && (
        <p role="alert">{tr("无法读取模型出站设置，请重试。")}</p>
      )}
      <select
        aria-label={tr("AI 出站策略")}
        disabled={busy || !saved}
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        value={selected}
        onChange={(e) => {
          setMode(e.target.value);
          setMessage("");
        }}
      >
        <option value="direct">{tr("直连")}</option>
        <option value="managed-network">{tr("本应用网络")}</option>
        <option value="custom-proxy">{tr("自定义代理")}</option>
      </select>
      {selected === "custom-proxy" && (
        <Input
          aria-label={tr("自定义 AI 代理")}
          type="password"
          autoComplete="off"
          disabled={busy}
          placeholder={tr("http://127.0.0.1:7890")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {tr(
          "本应用网络不可用时请求会失败，不会自动直连；已开始的请求继续使用原出口。",
        )}
      </p>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <Button
        disabled={
          busy ||
          !saved ||
          !dirty ||
          (selected === "custom-proxy" && !url.trim())
        }
        onClick={async () => {
          setBusy(true);
          try {
            await networkApi("outbound.set", { mode: selected, url });
            setMode(null);
            setUrl("");
            await client.invalidateQueries({ queryKey: ["network"] });
            setMessage(tr("AI 出站策略已保存"));
          } catch {
            setMessage(tr("模型出站策略保存失败，请检查代理地址后重试。"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {tr(busy ? "处理中…" : "应用策略")}
      </Button>
    </section>
  );
}
