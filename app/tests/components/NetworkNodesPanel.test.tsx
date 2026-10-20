import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NetworkNodesPanel } from "@/components/network/NetworkNodesPanel";
import { defaultDesktopPreferences } from "@/lib/desktopPreferencesModel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktopPreferences", () => ({
  useWorkspacePreferences: () => defaultDesktopPreferences,
}));
const base = {
  generation: 7,
  profile: "fixture",
  probe: "https://example.com/204",
  onProbeChange: vi.fn(),
  search: "",
  onSearchChange: vi.fn(),
  timeout: 5000,
  busy: false,
  onSelect: vi.fn(),
};
beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  base.onSelect.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(invoke).mockImplementation(async (_cmd, payload: any) => ({
    generation: payload.args.generation,
    delay: 42,
  }));
});
it("renders actual latency per node, retains partial failures and leaves selection usable during a group test", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(async (_cmd, payload: any) => {
    if (payload.args.node === "慢节点")
      return new Promise((resolve) => {
        finish = resolve;
      });
    if (payload.args.node === "失败节点") throw new Error("probe timed out");
    return { generation: 7, delay: 123 };
  });
  render(
    <NetworkNodesPanel
      {...base}
      proxies={{
        "香港 + 代理": {
          all: ["快节点", "慢节点", "失败节点", "快节点"],
          now: "快节点",
          type: "Selector",
        },
        快节点: { type: "Trojan", udp: true },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "分组测速 香港 + 代理" }));
  await screen.findByText("123 ms");
  await screen.findByText("超时/错误");
  expect(screen.getByRole("button", { name: "慢节点" })).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "分组测速 香港 + 代理" }),
  ).toBeDisabled();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([, p]: any) => p.args.node === "快节点"),
  ).toHaveLength(1);
  await act(async () => finish({ generation: 7, delay: 456 }));
  expect(await screen.findByText("456 ms")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "快节点" }));
  expect(base.onSelect).toHaveBeenCalledWith("香港 + 代理", "快节点");
  expect(screen.getByText("Trojan")).toBeInTheDocument();
});
it("limits probes to four, drops queued old-generation work and discards late results", async () => {
  const waiting: (() => void)[] = [];
  let active = 0,
    max = 0;
  vi.mocked(invoke).mockImplementation(
    (_cmd, payload: any) =>
      new Promise((resolve) => {
        active++;
        max = Math.max(max, active);
        waiting.push(() => {
          active--;
          resolve({ generation: payload.args.generation, delay: 99 });
        });
      }),
  );
  const proxies = {
    A: {
      all: Array.from({ length: 20 }, (_, i) => `Node ${i}`),
      now: "Node 0",
      type: "Selector",
    },
  };
  const view = render(<NetworkNodesPanel {...base} proxies={proxies} />);
  fireEvent.click(screen.getByRole("button", { name: "分组测速 A" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
  view.rerender(
    <NetworkNodesPanel {...base} generation={8} proxies={proxies} />,
  );
  await act(async () => waiting.splice(0).forEach((done) => done()));
  expect(invoke).toHaveBeenCalledTimes(4);
  expect(screen.queryByText("99 ms")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "分组测速 A" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(8));
  view.unmount();
  await act(async () => waiting.splice(0).forEach((done) => done()));
  expect(invoke).toHaveBeenCalledTimes(8);
  expect(max).toBe(4);
});
it("rejects invalid probe URLs without IPC and drops results after a URL edit", async () => {
  const proxies = { A: { all: ["Node"], type: "Selector" } };
  const view = render(
    <NetworkNodesPanel
      {...base}
      probe="file:///etc/passwd"
      proxies={proxies}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "分组测速 A" }));
  expect(screen.getByRole("alert")).toHaveTextContent("HTTP(S)");
  expect(invoke).not.toHaveBeenCalled();
  view.rerender(<NetworkNodesPanel {...base} proxies={proxies} />);
  fireEvent.click(screen.getByRole("button", { name: "分组测速 A" }));
  await screen.findByText("42 ms");
  view.rerender(
    <NetworkNodesPanel
      {...base}
      probe="https://example.org/204"
      proxies={proxies}
    />,
  );
  expect(screen.queryByText("42 ms")).not.toBeInTheDocument();
});
it("pins groups persistently, supports sticky headers, sorting, collapse and current-node location across pages", async () => {
  const nodes = Array.from({ length: 1000 }, (_, i) => `Node ${i}`);
  const proxies = {
    A: { all: ["A1"], type: "Selector" },
    B: { all: nodes, now: "Node 999", type: "Selector" },
  };
  const view = render(<NetworkNodesPanel {...base} proxies={proxies} />);
  fireEvent.click(screen.getByRole("button", { name: "置顶分组 B" }));
  expect(view.container.querySelector("article")).toHaveAttribute(
    "data-proxy-group",
    "B",
  );
  expect(screen.getAllByTestId("proxy-group-header")[0]).toHaveClass(
    "sticky",
    "top-0",
  );
  fireEvent.click(screen.getByRole("button", { name: "收起分组 B" }));
  expect(
    screen.queryByRole("button", { name: "Node 0" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "定位当前节点 B" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Node 999" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  expect(
    screen.getAllByRole("button", { name: /^Node / }).length,
  ).toBeLessThanOrEqual(60);
  view.unmount();
  const again = render(<NetworkNodesPanel {...base} proxies={proxies} />);
  expect(again.container.querySelector("article")).toHaveAttribute(
    "data-proxy-group",
    "B",
  );
  expect(screen.getByRole("button", { name: "取消置顶 B" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
it("sorts by settled delays and keeps automatic load balancing selection disabled", async () => {
  vi.mocked(invoke).mockImplementation(async (_cmd, p: any) => ({
    generation: 7,
    delay: p.args.node === "Slow" ? 400 : 50,
  }));
  const view = render(
    <NetworkNodesPanel
      {...base}
      proxies={{ A: { all: ["Slow", "Fast"], type: "LoadBalance" } }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "排序 A" }));
  fireEvent.click(screen.getByRole("button", { name: "分组测速 A" }));
  await screen.findByText("50 ms");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "分组测速 A" })).toBeEnabled(),
  );
  const group = within(view.container.querySelector("article")!);
  expect(group.getByRole("button", { name: "Fast" })).toBeDisabled();
  expect(
    group
      .getAllByRole("button")
      .filter((b) => ["Slow", "Fast"].includes(b.textContent ?? ""))
      .map((b) => b.textContent),
  ).toEqual(["Fast", "Slow"]);
});
