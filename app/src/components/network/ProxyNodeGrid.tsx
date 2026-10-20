import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ProxyInfo, ProxyDelay } from "./proxyNodes";
import { Activity, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNetworkText } from "./networkText";
import "./network-layout.css";
/** Explicit paging bounds the DOM; filtering still searches every node in the group. */
export function ProxyNodeGrid({
  nodes,
  current,
  columns,
  busy,
  resetKey = "",
  locateToken = 0,
  selectable = true,
  metadata = {},
  delays = {},
  onSelect,
  onTest,
}: {
  nodes: string[];
  current: string;
  columns: number;
  busy: boolean;
  resetKey?: string;
  locateToken?: number;
  selectable?: boolean;
  metadata?: Record<string, ProxyInfo>;
  delays?: Record<string, ProxyDelay>;
  onSelect: (node: string) => void;
  onTest: (node: string) => void;
}) {
  const tr = useNetworkText();
  const [page, setPage] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const locate = useRef({ nodes, current });
  locate.current = { nodes, current };
  useEffect(() => {
    setPage(0);
  }, [nodes.length, resetKey]);
  useEffect(() => {
    if (!locateToken) return;
    const index = locate.current.nodes.indexOf(locate.current.current);
    if (index < 0) return;
    setPage(Math.floor(index / 60));
    const frame = requestAnimationFrame(() =>
      grid.current
        ?.querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [locateToken]);
  const total = Math.max(1, Math.ceil(nodes.length / 60));
  const pageIndex = Math.min(page, total - 1);
  return (
    <>
      <div
        ref={grid}
        className="proxy-node-grid"
        style={{ "--node-columns": Math.max(1, columns) } as CSSProperties}
      >
        {nodes.slice(pageIndex * 60, pageIndex * 60 + 60).map((node) => (
          <div
            key={node}
            className="proxy-node-card"
            data-selected={current === node}
          >
            <button
              disabled={busy || !selectable}
              aria-label={node}
              aria-pressed={current === node}
              className="proxy-node-select"
              onClick={() => onSelect(node)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="proxy-node-name" title={node}>
                  {node}
                </span>
                {current === node && (
                  <span className="proxy-node-indicator" aria-hidden="true">
                    <Check size={11} />
                  </span>
                )}
              </span>
              {metadata[node]?.type && (
                <span
                  className="proxy-node-meta"
                  title={`${metadata[node].type}${metadata[node].udp ? " · UDP" : ""}`}
                >
                  <span>{metadata[node].type}</span>
                  {metadata[node].udp && <span>· UDP</span>}
                </span>
              )}
            </button>
            <button
              disabled={busy || delays[node]?.state === "testing"}
              aria-label={`${tr("测速")} ${node}`}
              title={delays[node]?.message ?? tr("测速")}
              className="proxy-node-delay"
              data-tone={
                !delays[node] || delays[node]?.state === "testing"
                  ? "neutral"
                  : delays[node]?.state === "error"
                    ? "error"
                    : (delays[node]?.delay ?? Infinity) < 300
                      ? "fast"
                      : (delays[node]?.delay ?? Infinity) < 800
                        ? "medium"
                        : "slow"
              }
              onClick={() => onTest(node)}
            >
              {delays[node]?.state === "testing" ? (
                <Loader2
                  size={14}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : delays[node]?.state === "error" ? (
                tr("超时/错误")
              ) : delays[node]?.state === "success" ? (
                `${delays[node].delay} ms`
              ) : (
                <>
                  <Activity size={13} />
                  <span>{tr("测速")}</span>
                </>
              )}
            </button>
          </div>
        ))}
      </div>
      {total > 1 && (
        <div className="mt-3 flex items-center justify-end gap-3 text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={pageIndex === 0}
            onClick={() => setPage(pageIndex - 1)}
          >
            {tr("上一页")}
          </Button>
          <span>
            {pageIndex + 1} / {total} · {nodes.length}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pageIndex === total - 1}
            onClick={() => setPage(pageIndex + 1)}
          >
            {tr("下一页")}
          </Button>
        </div>
      )}
    </>
  );
}
