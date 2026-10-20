// Development-only entry: production Vite build includes index.html only.
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ProxyNodeGrid } from "./components/network/ProxyNodeGrid";
import { useSessionSearch } from "./hooks/useSessionSearch";
import type { SessionMeta } from "./types";
import "./index.css";
const nodes = Array.from({ length: 1000 }, (_, i) => `Fixture ${i}`);
const sessions = Array.from({ length: 10000 }, (_, i) => ({
  sessionId: `fixture-${i}`,
  providerId: "codex",
  title: `Fixture conversation ${i}`,
  summary: `Planning and testing workspace task number ${i}`,
  projectDir: `/isolated/project-${i % 100}`,
  sourcePath: `/isolated/sessions/2026/10/16/rollout-2026-10-16T10-00-00-${i}.jsonl`,
  lastActiveAt: i,
})) as SessionMeta[];
function Search({ done }: { done: (value: number) => void }) {
  const start = performance.now();
  const { search } = useSessionSearch({ sessions, providerFilter: "all" });
  const found = search("9999");
  useLayoutEffect(() => {
    done(performance.now() - start);
  }, []);
  return (
    <p>
      会话数 {sessions.length}，搜索结果 {found.map((v) => v.title).join(",")}
    </p>
  );
}
function Harness() {
  const [view, setView] = useState("nodes");
  const [report, setReport] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    const timings: number[] = [];
    const mountStart = performance.now();
    flushSync(() => setView("sessions"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const sessionPaintMs = performance.now() - mountStart;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      flushSync(() => setView(i % 2 === 0 ? "nodes" : "sessions"));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    setReport({
      environment:
        "real browser; cached data; components unmounted on navigation; no native IPC",
      sessionPaintMs,
      cachedSwitchP95Ms: timings[18],
      switches: 20,
      maxSwitchMs: timings[19],
      indexTimingsMs: indexSamples,
      pass: timings[18] <= 200 && Math.max(...indexSamples) <= 1000,
    });
    setRunning(false);
  };
  return (
    <main className="p-6">
      <h1>Sivio 隔离性能夹具</h1>
      <p>
        仅合成数据，复用实际节点分页组件与会话搜索
        Hook；不连接账户、系统代理或应用数据库。
      </p>
      <button disabled={running} onClick={run}>
        {running ? "测试中" : "运行规模与切换测试"}
      </button>
      <pre aria-label="性能结果">{JSON.stringify(report, null, 2)}</pre>
      {view === "sessions" ? (
        <Search done={(v) => indexSamples.push(v)} />
      ) : (
        <div>
          <ProxyNodeGrid
            nodes={nodes}
            current="Fixture 999"
            columns={3}
            busy={false}
            onSelect={() => {}}
            onTest={() => {}}
          />
        </div>
      )}
    </main>
  );
}
const indexSamples: number[] = [];
createRoot(document.getElementById("root")!).render(<Harness />);
