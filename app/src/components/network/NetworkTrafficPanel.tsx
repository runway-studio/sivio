import { useWorkspacePreferences } from "@/lib/desktopPreferences";
import { useTranslation } from "react-i18next";
import { NetworkTrafficChart } from "./NetworkTrafficChart";
import { useNetworkTraffic } from "./useNetworkTraffic";
function bytes(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
}
export function NetworkTrafficPanel({
  running,
  generation,
  active = true,
}: {
  running: boolean;
  generation: number;
  active?: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const preferences = useWorkspacePreferences();
  const { traffic, memory, history, visible } = useNetworkTraffic({
    running,
    generation,
    active,
    memoryUsage: preferences.memoryUsage,
    pauseTrafficOnBlur: preferences.pauseTrafficOnBlur,
  });
  const latest = running && !traffic.isError ? traffic.data : undefined;
  const memoryValue = running && !memory.isError ? memory.data : undefined;
  return (
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [zh ? "上传速度" : "Upload rate", `${bytes(latest?.traffic.up)}/s`],
          [
            zh ? "下载速度" : "Download rate",
            `${bytes(latest?.traffic.down)}/s`,
          ],
          [zh ? "内核内存" : "Core memory", bytes(memoryValue?.memory.inuse)],
        ]
          .filter((_, index) => index !== 2 || preferences.memoryUsage)
          .map(([title, value]) => (
            <div key={title} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{title}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
      </div>
      {preferences.trafficGraph && (
        <div
          className={`rounded-xl border bg-card p-5 ${traffic.isError ? "opacity-50" : ""}`}
        >
          <p className="mb-4 text-sm">
            {zh ? "实时流量 · 最近 60 秒" : "Live traffic · last 60 seconds"}
          </p>
          <NetworkTrafficChart
            history={history}
            animate={running && visible && !traffic.isError}
            label={
              zh ? "上传与下载速度趋势" : "Upload and download rate history"
            }
          />
          <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
            <span className="text-primary">
              ↑ {zh ? "累计上传" : "Uploaded"} {bytes(latest?.traffic.upTotal)}
            </span>
            <span className="text-emerald-600">
              ↓ {zh ? "累计下载" : "Downloaded"}{" "}
              {bytes(latest?.traffic.downTotal)}
            </span>
          </div>
        </div>
      )}
      <p
        role={traffic.isError ? "alert" : "status"}
        className={`text-xs ${traffic.isError ? "text-destructive" : "text-muted-foreground"}`}
      >
        {!running
          ? zh
            ? "内核已停止，采样已暂停"
            : "Core stopped; sampling paused"
          : traffic.isError
            ? zh
              ? "数据已过期，正在尝试重新连接"
              : "Data is stale; reconnecting"
            : !visible && preferences.pauseTrafficOnBlur
              ? zh
                ? "窗口在后台，采样已暂停"
                : "View hidden; sampling paused"
              : memory.isError && preferences.memoryUsage
                ? zh
                  ? "内存数据暂不可用，流量采样继续运行"
                  : "Memory unavailable; traffic sampling continues"
                : latest
                  ? zh
                    ? "仅统计当前内核运行，不重复累加历史采样。离开页面后停止采样。"
                    : "Totals belong to this core run and do not accumulate sampled history. Sampling stops when you leave this view."
                  : zh
                    ? "正在等待内核流量数据…"
                    : "Waiting for core metrics…"}
      </p>
    </section>
  );
}
