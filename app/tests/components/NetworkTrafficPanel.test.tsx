import { Profiler, useState, type ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  appendTraffic,
  trafficPath,
  type TrafficSample,
} from "@/components/network/networkTraffic";
import { NetworkTrafficChart } from "@/components/network/NetworkTrafficChart";
import { NetworkTrafficPanel } from "@/components/network/NetworkTrafficPanel";
import { useNetworkTraffic } from "@/components/network/useNetworkTraffic";
import { defaultDesktopPreferences } from "@/lib/desktopPreferencesModel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const preferences = { ...defaultDesktopPreferences };
vi.mock("@/lib/desktopPreferences", () => ({
  useWorkspacePreferences: () => preferences,
}));
const sample = (sampledAt: number, generation = 1): TrafficSample => ({
  sampledAt,
  generation,
  traffic: { up: 1, down: 2, upTotal: 10, downTotal: 20 },
});
let hidden = false;
let reduced = false;
let motionChange: (() => void) | undefined;
let calls: { metric: string; at: number }[];
let clients: QueryClient[];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  hidden = false;
  reduced = false;
  clients = [];
  calls = [];
  Object.assign(preferences, defaultDesktopPreferences);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_event: string, listener: () => void) => {
      motionChange = listener;
    },
    removeEventListener: () => {
      motionChange = undefined;
    },
  }));
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (_cmd, payload: any) => {
      const { metric, generation } = payload.args;
      calls.push({ metric, at: performance.now() });
      await new Promise((resolve) =>
        setTimeout(resolve, metric === "memory" ? 2_000 : 1_000),
      );
      return metric === "memory"
        ? { sampledAt: Date.now(), generation, memory: { inuse: 4096 } }
        : sample(Date.now(), generation);
    });
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const value = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(value);
    return value;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const props = {
  running: true,
  generation: 1,
  memoryUsage: true,
  pauseTrafficOnBlur: true,
};
const advance = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const visibility = (value: boolean) =>
  act(() => {
    hidden = value;
    document.dispatchEvent(new Event("visibilitychange"));
  });

it("caps history, ignores duplicate/out-of-order samples and resets across core generations", () => {
  let history = [sample(1)];
  for (let time = 2; time <= 120; time++)
    history = appendTraffic(history, sample(time));
  expect(history).toHaveLength(60);
  expect(history[0].sampledAt).toBe(61);
  expect(appendTraffic(history, sample(120))).toBe(history);
  expect(appendTraffic(history, sample(119))).toBe(history);
  expect(appendTraffic(history, sample(121, 2))).toEqual([sample(121, 2)]);
  expect(history.at(-1)?.traffic.upTotal).toBe(10);
});
it("places fresh samples at the right edge with real time spacing and breaks across gaps", () => {
  const path = trafficPath(
    [sample(1_000), sample(2_000), sample(8_000)],
    "up",
    8_000,
    2,
  );
  expect(path).toMatch(/^M530,52 C/);
  expect(path).toMatch(/ M600,52$/);
  expect(path.match(/C/g)).toHaveLength(1);
});
it("delivers traffic independently of memory and compensates for the native read duration", async () => {
  const view = renderHook(() => useNetworkTraffic(props), { wrapper });
  await advance(1_010);
  expect(view.result.current.history).toHaveLength(1);
  expect(view.result.current.memory.data).toBeUndefined();
  await advance(5_500);
  const traffic = calls.filter((call) => call.metric === "traffic");
  expect(traffic.length).toBeGreaterThanOrEqual(6);
  for (let i = 1; i < traffic.length; i++)
    expect(traffic[i].at - traffic[i - 1].at).toBeLessThanOrEqual(1_100);
  expect(calls.filter((call) => call.metric === "memory")).toHaveLength(2);
  expect(view.result.current.history.at(-1)?.traffic.upTotal).toBe(10);
  view.unmount();
});
it("pauses hidden polling, resumes it, and stops new requests on unmount", async () => {
  const view = renderHook(() => useNetworkTraffic(props), { wrapper });
  await advance(1_010);
  visibility(true);
  const count = calls.length;
  await advance(7_000);
  expect(calls).toHaveLength(count);
  visibility(false);
  await advance(1_010);
  expect(calls.length).toBeGreaterThan(count);
  view.unmount();
  const afterUnmount = calls.length;
  await advance(10_000);
  expect(calls).toHaveLength(afterUnmount);
});
it("honors background sampling preference and omits disabled memory requests", async () => {
  hidden = true;
  const view = renderHook(
    () =>
      useNetworkTraffic({
        ...props,
        memoryUsage: false,
        pauseTrafficOnBlur: false,
      }),
    { wrapper },
  );
  await advance(3_200);
  expect(calls.length).toBeGreaterThanOrEqual(3);
  expect(calls.every((call) => call.metric === "traffic")).toBe(true);
  view.unmount();
});
it("does not mix late data when a core restarts, and clears immediately when stopped", async () => {
  const view = renderHook((current) => useNetworkTraffic(current), {
    wrapper,
    initialProps: props,
  });
  await advance(1_010);
  expect(view.result.current.history).toHaveLength(1);
  view.rerender({ ...props, generation: 2 });
  expect(view.result.current.history).toHaveLength(0);
  await advance(1_010);
  expect(
    view.result.current.history.every((entry) => entry.generation === 2),
  ).toBe(true);
  view.rerender({ ...props, generation: 2, running: false });
  expect(view.result.current.history).toHaveLength(0);
  const count = calls.length;
  await advance(8_000);
  expect(calls).toHaveLength(count);
  view.unmount();
});
it("keeps traffic visible on memory failure and reports stopped, waiting and stale states", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((cmd, args: any) =>
    args.args.metric === "memory"
      ? Promise.reject(new Error("memory unavailable"))
      : original(cmd, args),
  );
  const view = render(<NetworkTrafficPanel running generation={1} />, {
    wrapper,
  });
  expect(screen.getByRole("status")).toHaveTextContent("正在等待");
  await advance(1_010);
  expect(screen.getByText("1 B/s")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("内存数据暂不可用");
  vi.mocked(invoke).mockRejectedValue(new Error("disconnected"));
  await advance(1_100);
  expect(screen.getByRole("alert")).toHaveTextContent("数据已过期");
  view.rerender(<NetworkTrafficPanel running={false} generation={1} />);
  expect(screen.getByText("内核已停止，采样已暂停")).toBeInTheDocument();
  view.unmount();
});
it("animates paths without per-frame React commits and cancels frames on hidden/reduced motion/unmount", async () => {
  // Fake rAF timestamps share the same clock used by the chart effect.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  let commits = 0;
  const initial = [sample(1_000), sample(2_000)];
  const renderChart = (history: TrafficSample[]) => (
    <Profiler id="traffic" onRender={() => commits++}>
      <NetworkTrafficChart history={history} animate label="chart" />
    </Profiler>
  );
  const view = render(renderChart(initial));
  const path = view.container.querySelector("path")!;
  view.rerender(renderChart([...initial, sample(3_000)]));
  const start = path.getAttribute("d");
  const rendered = commits;
  await advance(300);
  expect(path.getAttribute("d")).not.toBe(start);
  expect(commits).toBe(rendered);
  visibility(true);
  const hiddenPath = path.getAttribute("d");
  await advance(1_000);
  expect(path.getAttribute("d")).toBe(hiddenPath);
  visibility(false);
  reduced = true;
  act(() => motionChange?.());
  const reducedPath = path.getAttribute("d");
  await advance(1_000);
  expect(path.getAttribute("d")).toBe(reducedPath);
  expect(vi.getTimerCount()).toBe(0);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("renders a bounded static chart in reduced motion and clears paths across an empty generation", () => {
  reduced = true;
  const frame = vi.spyOn(window, "requestAnimationFrame");
  const view = render(
    <NetworkTrafficChart
      history={[sample(1), sample(1001)]}
      animate
      label="chart"
    />,
  );
  expect(frame).not.toHaveBeenCalled();
  view.rerender(<NetworkTrafficChart history={[]} animate label="chart" />);
  expect(view.container.querySelector("path")).toHaveAttribute("d", "");
});

it("retains the chart DOM and samples across inactive views without background animation or polling", async () => {
  const view = render(<NetworkTrafficPanel running generation={1} />, {
    wrapper,
  });
  await advance(3_300);
  const chart = screen.getByRole("img");
  const path = chart.querySelector("path")!;
  expect(path.getAttribute("d")).toContain("C");
  view.rerender(<NetworkTrafficPanel running generation={1} active={false} />);
  const count = calls.length;
  await advance(5_000);
  expect(calls.length).toBe(count);
  view.rerender(<NetworkTrafficPanel running generation={1} active />);
  expect(screen.getByRole("img")).toBe(chart);
  expect(chart.querySelector("path")).toBe(path);
  expect(path.getAttribute("d")).toContain("C");
  view.unmount();
});

it("restores bounded history immediately after an entire workspace remount", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const sameClient = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const first = renderHook(() => useNetworkTraffic(props), {
    wrapper: sameClient,
  });
  await advance(3_300);
  const history = first.result.current.history;
  expect(history.length).toBeGreaterThan(1);
  first.unmount();
  const second = renderHook(() => useNetworkTraffic(props), {
    wrapper: sameClient,
  });
  expect(second.result.current.history).toEqual(history);
  second.unmount();
});
