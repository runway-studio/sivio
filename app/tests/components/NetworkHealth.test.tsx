import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NetworkHealth } from "@/components/network/NetworkHealth";
import type { NetworkSnapshot } from "@/components/network/networkTypes";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const snapshot = {
  settingsRevision: "s1",
  helper: null,
  helperCompatible: true,
  helperAuthorized: true,
  catalog: {
    active: "p",
    profiles: [
      {
        id: "p",
        revision: "p1",
        name: "Profile",
        kind: "remote",
        updated: 1,
        interval: 60,
      },
    ],
    settings: {} as NetworkSnapshot["catalog"]["settings"],
    outbound: "managed-network",
  },
  runtime: {
    phase: "running",
    generation: 7,
    managed: true,
    port: 7891,
    active: "p",
    error: null,
  },
} satisfies NetworkSnapshot;
function mount() {
  const settings = vi.fn();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = (value: NetworkSnapshot) => (
    <QueryClientProvider client={cache}>
      <NetworkHealth
        snapshot={value}
        onManage={vi.fn()}
        onSettings={settings}
      />
    </QueryClientProvider>
  );
  const view = render(ui(snapshot));
  return {
    ...view,
    cache,
    settings,
    update: (value: NetworkSnapshot) => view.rerender(ui(value)),
  };
}
beforeEach(() => {
  onlineManager.setOnline(true);
  vi.mocked(invoke).mockReset().mockResolvedValue({
    httpStatus: 204,
    elapsedMs: 42,
    successfulHttpResponse: true,
  });
});
it("only probes on user action and distinguishes HTTP failures from running service", async () => {
  vi.mocked(invoke).mockResolvedValue({
    httpStatus: 403,
    elapsedMs: 55,
    successfulHttpResponse: false,
  });
  mount();
  expect(invoke).not.toHaveBeenCalled();
  expect(screen.getByText("网络服务运行中 · 连接待验证")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
  expect(await screen.findByText("检测目标连接失败")).toBeInTheDocument();
  expect(screen.getByText(/Apple · HTTP 403/)).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "home.probe",
    args: { id: "apple", generation: 7 },
  });
});
it("rejects late success after the runtime identity changes and prevents duplicate probes", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = mount();
  const button = screen.getByRole("button", { name: "检查连接" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(invoke).toHaveBeenCalledTimes(1);
  view.update({ ...snapshot, settingsRevision: "s2" });
  await act(async () => {
    resolve({ httpStatus: 204, elapsedMs: 42, successfulHttpResponse: true });
  });
  expect(screen.queryByText("检测目标连接通过")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "检查连接" })).toBeEnabled();
});
it("invalidates observations on focus/network changes and network cache invalidation", async () => {
  const { cache } = mount();
  cache.setQueryData(["network", "snapshot"], snapshot);
  fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
  await screen.findByText("检测目标连接通过");
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(screen.queryByText("检测目标连接通过")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
  await screen.findByText("检测目标连接通过");
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["network"] });
  });
  expect(screen.queryByText("检测目标连接通过")).not.toBeInTheDocument();
});
it("clears old evidence as soon as a configuration mutation begins", async () => {
  const { cache } = mount();
  fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
  await screen.findByText("检测目标连接通过");
  let finish!: () => void;
  let execution: Promise<unknown>;
  act(() => {
    const mutation = cache.getMutationCache().build(cache, {
      mutationFn: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    execution = mutation.execute(undefined);
  });
  await waitFor(() =>
    expect(screen.queryByText("检测目标连接通过")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  await act(async () => {
    finish();
    await execution;
  });
});
it("never probes when the service is stopped", () => {
  const view = mount();
  view.update({
    ...snapshot,
    runtime: { ...snapshot.runtime, phase: "stopped" },
  });
  expect(screen.getByRole("button", { name: "检查连接" })).toBeDisabled();
  expect(invoke).not.toHaveBeenCalled();
});

it("does not promise a proxy recheck after native retries have stopped", () => {
  const view = mount();
  view.update({
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      phase: "failed",
      recoveryStatus: "idle",
      proxyGuardWaitingForNetwork: true,
      error: "Network service unavailable",
    },
  });
  expect(screen.getByText("运行失败")).toBeInTheDocument();
  expect(screen.getByText("Network service unavailable")).toBeInTheDocument();
  expect(screen.queryByText("等待系统网络服务")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开网络设置" })).toBeEnabled();
});

it("waits for a system network without claiming an external proxy edit", () => {
  const view = mount();
  view.update({
    ...snapshot,
    runtime: { ...snapshot.runtime, proxyGuardWaitingForNetwork: true },
  });
  expect(screen.getByText("等待系统网络服务")).toBeInTheDocument();
  expect(screen.queryByText("系统代理已被外部修改")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "检查连接" })).toBeDisabled();
  view.update(snapshot);
  expect(screen.getByRole("button", { name: "检查连接" })).toBeEnabled();
  expect(invoke).not.toHaveBeenCalled();
});

it("shows observed recovery progress and routes cleanup to network settings", () => {
  const view = mount();
  view.update({
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      phase: "failed",
      recoveryStatus: "retrying",
    },
  });
  expect(screen.getByText("正在恢复网络连接")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "检查连接" })).toBeDisabled();
  view.update({
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      phase: "failed",
      recoveryStatus: "waiting_for_network",
    },
  });
  expect(screen.getByText("等待网络恢复")).toBeInTheDocument();
  view.update({
    ...snapshot,
    runtime: {
      ...snapshot.runtime,
      phase: "failed",
      recoveryRequired: true,
      recoveryStatus: "retrying",
    },
  });
  expect(screen.getByText("网络清理尚未完成")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "打开网络设置" }));
  expect(view.settings).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

it("does not present previous probe success after external proxy takeover or app replacement", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "检查连接" }));
  await screen.findByText("检测目标连接通过");
  view.update({
    ...snapshot,
    runtime: { ...snapshot.runtime, proxyGuardTripped: true },
  });
  expect(screen.getByText("系统代理已被外部修改")).toBeInTheDocument();
  expect(screen.queryByText("检测目标连接通过")).not.toBeInTheDocument();
  view.update({ ...snapshot, appRestartRequired: true });
  expect(screen.getByText("需要重新打开 Sivio")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "检查连接" })).toBeDisabled();
  view.update(snapshot);
  expect(screen.getByText("网络服务运行中 · 连接待验证")).toBeInTheDocument();
});

it("retries unreadable system proxy state without claiming another app took over", () => {
  const view = mount();
  view.update({
    ...snapshot,
    runtime: { ...snapshot.runtime, proxyGuardInspectionUnavailable: true },
  });
  expect(screen.getByText("暂时无法核对系统代理")).toBeInTheDocument();
  expect(screen.queryByText("系统代理已被外部修改")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "检查连接" })).toBeDisabled();
  view.update(snapshot);
  expect(screen.getByRole("button", { name: "检查连接" })).toBeEnabled();
});
