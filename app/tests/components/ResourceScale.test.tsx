import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProxyNodeGrid } from "@/components/network/ProxyNodeGrid";
import { useSessionSearch } from "@/hooks/useSessionSearch";
import type { SessionMeta } from "@/types";

it("keeps 1000 proxy nodes bounded and reaches the last page", () => {
  const nodes = Array.from({ length: 1000 }, (_, index) => `Fixture ${index}`);
  const select = vi.fn();
  const started = performance.now();
  render(
    <ProxyNodeGrid
      nodes={nodes}
      current="Fixture 999"
      columns={3}
      busy={false}
      onSelect={select}
      onTest={() => {}}
    />,
  );
  expect(screen.getAllByRole("button", { name: /^测速 Fixture/ })).toHaveLength(
    60,
  );
  for (let i = 0; i < 16; i++)
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getAllByRole("button", { name: /^测速 Fixture/ })).toHaveLength(
    40,
  );
  fireEvent.click(screen.getByRole("button", { name: "Fixture 999" }));
  expect(select).toHaveBeenCalledWith("Fixture 999");
  console.info(
    JSON.stringify({
      benchmark: "node-paging-jsdom",
      nodes: 1000,
      pages: 17,
      totalMs: performance.now() - started,
    }),
  );
});

it("indexes and searches 10000 session metadata records", () => {
  const sessions = Array.from({ length: 10000 }, (_, index) => ({
    sessionId: `12345678-abcd-efab-cdef-${String(index).padStart(12, "0")}`,
    providerId: "codex",
    title: `Fixture conversation ${index}`,
    summary: `Planning and testing workspace task number ${index}`,
    projectDir: `/isolated/workspace/project-${index % 100}`,
    sourcePath: `/isolated/sessions/2026/10/16/rollout-2026-10-16T10-00-00-${index}.jsonl`,
    lastActiveAt: index,
  })) as SessionMeta[];
  const started = performance.now();
  const { result } = renderHook(() =>
    useSessionSearch({ sessions, providerFilter: "all" }),
  );
  const indexingMs = performance.now() - started;
  const searchStart = performance.now();
  let found: SessionMeta[] = [];
  act(() => {
    found = result.current.search("9999");
  });
  expect(found.some((row) => row.title === "Fixture conversation 9999")).toBe(
    true,
  );
  expect(result.current.search("")).toHaveLength(10000);
  console.info(
    JSON.stringify({
      benchmark: "session-index-jsdom",
      records: 10000,
      indexingMs,
      searchMs: performance.now() - searchStart,
    }),
  );
  if (process.env.SI_PERFORMANCE === "1") expect(indexingMs).toBeLessThan(1000);
}, 30000);

it("reuses the latest immutable session rows across navigation and invalidates changed rows", () => {
  const rows = [
    {
      sessionId: "cache-fixture",
      providerId: "codex",
      title: "originaltitle",
      lastActiveAt: 1,
    },
  ] as SessionMeta[];
  const first = renderHook(() =>
    useSessionSearch({ sessions: rows, providerFilter: "all" }),
  );
  expect(first.result.current.search("originaltitle")).toHaveLength(1);
  first.unmount();
  const second = renderHook(
    ({ sessions }) => useSessionSearch({ sessions, providerFilter: "all" }),
    { initialProps: { sessions: [...rows] } },
  );
  expect(second.result.current.search("originaltitle")).toHaveLength(1);
  second.rerender({ sessions: [{ ...rows[0], title: "replacementtitle" }] });
  expect(second.result.current.search("originaltitle")).toHaveLength(0);
  expect(second.result.current.search("replacementtitle")).toHaveLength(1);
  second.rerender({ sessions: [] });
  expect(second.result.current.search("replacementtitle")).toHaveLength(0);
});
