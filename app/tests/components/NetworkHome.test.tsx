import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  NetworkHome,
  subscriptionUsage,
} from "@/components/network/NetworkHome";
import type { NetworkSnapshot } from "@/components/network/networkTypes";
import { hasPendingMutation } from "@/lib/unsavedChanges";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/network/NetworkTrafficPanel", () => ({
  NetworkTrafficPanel: () => <div>Traffic fixture</div>,
}));
let snapshot: NetworkSnapshot;
beforeEach(() => {
  localStorage.clear();
  snapshot = {
    settingsRevision: "revision-1",
    helper: null,
    helperCompatible: false,
    helperAuthorized: false,
    runtime: {
      phase: "running",
      generation: 3,
      managed: false,
      port: 15722,
      active: "p1",
      error: null,
    },
    catalog: {
      active: "p1",
      outbound: "direct",
      profiles: [
        {
          id: "p1",
          name: "Demo subscription",
          kind: "remote",
          revision: "profile-1",
          updated: 1700000000,
          interval: 60,
          usage: "upload=1024; download=2048; total=4096; expire=1800000000",
        },
      ],
      settings: {
        mode: "rule",
        tun: false,
        systemProxy: false,
        mixedPort: 15722,
        customTests: [],
      } as any,
    },
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (cmd, p: any) => {
      if (cmd === "get_auto_launch_status") return false;
      if (p?.action === "controller") {
        if (p.args.path === "/proxies")
          return {
            proxies: {
              "Proxy / 代理": {
                type: "Selector",
                now: "Hong Kong",
                all: ["Hong Kong", "Japan"],
              },
              "Hong Kong": { type: "Trojan", udp: true },
              Japan: { type: "Trojan" },
            },
          };
        if (p.args.path === "/rules") return { rules: [{}] };
        return { version: "v1.19.0" };
      }
      if (p?.action === "home.probe")
        return p.args.id === "ip"
          ? { ip: "203.0.113.1", country: "Japan", asn: 64500 }
          : { httpStatus: 204, elapsedMs: 35, successfulHttpResponse: true };
      if (p?.action === "diagnostics")
        return { appVersion: "0.1.0", arch: "aarch64", os: "macOS" };
      return {};
    });
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = vi.fn();
  const ui = (value: NetworkSnapshot) => (
    <QueryClientProvider client={client}>
      <NetworkHome snapshot={value} onNavigate={navigate} />
    </QueryClientProvider>
  );
  const view = render(ui(snapshot));
  return {
    ...view,
    navigate,
    client,
    update: (value: NetworkSnapshot) => view.rerender(ui(value)),
  };
}
it("shows subscription usage, hides outbound IP by default and selects nodes with a generation guard", async () => {
  const view = mount();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "75",
  );
  expect(await screen.findByText("AS64500")).toBeInTheDocument();
  expect(screen.queryByText("203.0.113.1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "显示 IP" }));
  expect(screen.getByText("203.0.113.1")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByLabelText("当前节点选择")).toHaveValue("Hong Kong"),
  );
  fireEvent.change(screen.getByLabelText("当前节点选择"), {
    target: { value: "Japan" },
  });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "controller",
      args: {
        method: "PUT",
        path: "/proxies/Proxy%20%2F%20%E4%BB%A3%E7%90%86",
        body: { name: "Japan" },
        expectedGeneration: 3,
      },
    }),
  );
  view.unmount();
});
it("pins quick settings to the revision, locks writes and preserves the old switch after failure", async () => {
  let reject: (reason: Error) => void = () => {};
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((cmd, p: any) =>
    p?.action === "settings.save"
      ? new Promise((_resolve, fail) => {
          reject = fail;
        })
      : original(cmd, p),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("switch", { name: "系统代理" }));
  await waitFor(() => expect(hasPendingMutation()).toBe(true));
  expect(screen.getByRole("switch", { name: "系统代理" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "全局" })).toBeDisabled();
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "settings.save",
    args: {
      baseRevision: "revision-1",
      takeOverProxy: true,
      settings: expect.objectContaining({
        systemProxy: true,
        mode: "rule",
        mixedPort: 15722,
      }),
    },
  });
  reject(new Error("应用失败；旧网络已恢复"));
  expect(await screen.findByRole("alert")).toHaveTextContent("旧网络已恢复");
  expect(screen.getByRole("switch", { name: "系统代理" })).not.toBeChecked();
  await waitFor(() => expect(hasPendingMutation()).toBe(false));
  view.unmount();
});
it("stops queries and clears live details when the network stops; profile switching stays available", async () => {
  const view = mount();
  expect(screen.getByLabelText("当前订阅")).toBeEnabled();
  await screen.findByText("AS64500");
  view.update({
    ...snapshot,
    runtime: { ...snapshot.runtime, phase: "stopped" },
  });
  expect(screen.queryByText("AS64500")).not.toBeInTheDocument();
  expect(screen.getByLabelText("当前订阅")).toBeEnabled();
  expect(screen.getByLabelText("当前节点选择")).toBeDisabled();
  expect(screen.getByRole("button", { name: "检测全部" })).toBeDisabled();
  view.unmount();
});
it("persists card visibility without querying hidden cards", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "首页卡片" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "出口 IP 信息" }));
  expect(
    screen.queryByRole("heading", { name: "出口 IP 信息" }),
  ).not.toBeInTheDocument();
  view.unmount();
  vi.mocked(invoke).mockClear();
  const next = mount();
  await screen.findByText("v1.19.0");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, p]: any) => p?.action === "home.probe"),
  ).toBe(false);
  next.unmount();
});
it("tests default destinations through the native probe and reports HTTP failures honestly", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((cmd, p: any) =>
    p?.action === "home.probe" && p.args.id === "google"
      ? Promise.resolve({
          httpStatus: 403,
          elapsedMs: 42,
          successfulHttpResponse: false,
        })
      : original(cmd, p),
  );
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "检测全部" }));
  expect(await screen.findByText("42 ms · HTTP 403")).toHaveClass(
    "text-destructive",
  );
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "home.probe",
    args: { id: "google", generation: 3 },
  });
  view.unmount();
});
it("treats missing or invalid subscription usage as unknown instead of zero", () => {
  expect(subscriptionUsage()).toEqual({
    used: undefined,
    total: undefined,
    expire: undefined,
  });
  expect(
    subscriptionUsage("upload=NaN; download=-2; total=; expire=oops"),
  ).toEqual({ used: undefined, total: undefined, expire: undefined });
});

it("shows saved proxy as inactive while stopped and starts it on quick enable", async () => {
  snapshot.runtime.phase = "stopped";
  snapshot.catalog.settings.systemProxy = true;
  const view = mount();
  expect(screen.getByRole("switch", { name: "系统代理" })).not.toBeChecked();
  expect(
    screen.getByText(/网络未运行，已保存的代理设置尚未生效/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "系统代理" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "settings.save",
      args: {
        baseRevision: "revision-1",
        startIfStopped: true,
        takeOverProxy: true,
        settings: expect.objectContaining({ systemProxy: true }),
      },
    }),
  );
  view.unmount();
});

it("shows external takeover as inactive and explicitly reapplies without restarting", async () => {
  snapshot.catalog.settings.systemProxy = true;
  snapshot.runtime.proxyGuardTripped = true;
  snapshot.runtime.managed = true;
  const view = mount();
  expect(screen.getByRole("switch", { name: "系统代理" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("switch", { name: "系统代理" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "proxy.reapply",
      args: { expectedGeneration: 3 },
    }),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args?.action === "settings.save"),
  ).toBe(false);
  view.unmount();
});
