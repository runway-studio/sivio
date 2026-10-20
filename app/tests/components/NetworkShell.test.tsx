import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "@/components/shell/Sidebar";
import { NetworkRuntimeProvider } from "@/components/network/NetworkRuntime";
import { NetworkWorkspace } from "@/components/network/NetworkWorkspace";
import { defaultDesktopPreferences } from "@/lib/desktopPreferencesModel";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => ({ hasUpdate: false }),
}));
vi.mock("@/lib/desktopPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktopPreferences")>()),
  useWorkspacePreferences: () => defaultDesktopPreferences,
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  DRAG_REGION_ATTR: { "data-tauri-drag-region": true },
  DRAG_REGION_STYLE: { WebkitAppRegion: "drag" },
}));
vi.mock("@/components/network/NetworkTrafficPanel", () => ({
  NetworkTrafficPanel: () => <div>traffic fixture</div>,
}));
vi.mock("@/components/JsonEditor", () => ({ default: () => null }));
let snapshot: any;
beforeEach(() => {
  localStorage.clear();
  snapshot = {
    settingsRevision: "fixture-revision",
    helper: null,
    helperCompatible: false,
    helperAuthorized: false,
    runtime: {
      phase: "stopped",
      generation: 1,
      port: null,
      managed: false,
      error: null,
    },
    catalog: {
      profiles: [],
      active: null,
      settings: {
        systemProxy: false,
        tun: false,
        latencyUrl: "https://example.com",
        latencyTimeout: 5000,
      },
      outbound: "direct",
    },
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (_cmd, p: any) => {
      if (p.action === "snapshot") return structuredClone(snapshot);
      if (p.action === "start") {
        snapshot.runtime.phase = "running";
        snapshot.runtime.port = 15722;
      }
      if (p.action === "stop") snapshot.runtime.phase = "stopped";
      return {};
    });
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const sidebarProps = {
    domain: "network",
    networkTab: "流量",
    onSelectNetworkTab: vi.fn(),
    onSelectDomain: vi.fn(),
    activeApp: "claude",
    view: "network",
    visibleApps: {},
    settingsSection: "general",
    onSelectApp: vi.fn(),
    onSelectPage: vi.fn(),
    onSelectSettingsSection: vi.fn(),
    onExitSettings: vi.fn(),
  } as any;
  return render(
    <QueryClientProvider client={client}>
      <NetworkRuntimeProvider active inShell>
        <Sidebar {...sidebarProps} />
        <div data-testid="content">
          <NetworkWorkspace selectedTab="流量" onTabChange={vi.fn()} />
        </div>
      </NetworkRuntimeProvider>
    </QueryClientProvider>,
  );
}
it("shares one snapshot and puts the only lifecycle control inside the secondary menu", async () => {
  const view = mount();
  const start = await screen.findByRole("button", { name: "启动网络" });
  await waitFor(() => expect(start).toBeEnabled());
  const menu = screen.getByTestId("secondary-navigation");
  expect(menu).toContainElement(start);
  expect(
    within(screen.getByTestId("content")).queryByTestId("network-control"),
  ).not.toBeInTheDocument();
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(([, p]: any) => p.action === "snapshot"),
  ).toHaveLength(1);
  fireEvent.click(start);
  expect(await screen.findByRole("button", { name: "停止" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  await screen.findByRole("button", { name: "启动网络" });
  view.unmount();
});
it("retains accessible controls when collapsed, uses vertical-only menu scrolling and marks noninteractive titles draggable", async () => {
  const view = mount();
  await screen.findByRole("button", { name: "启动网络" });
  const menu = screen.getByTestId("secondary-navigation");
  expect(menu.querySelector(".overflow-y-auto")).toHaveClass(
    "overflow-x-hidden",
  );
  expect(menu.innerHTML).not.toContain("w-[202px]");
  fireEvent.click(screen.getByRole("button", { name: "nav.collapseSidebar" }));
  expect(screen.getByRole("button", { name: "启动网络" })).toBeInTheDocument();
  const title = within(screen.getByTestId("content")).getByRole("heading", {
    name: "流量",
  });
  expect(title).toHaveAttribute("data-tauri-drag-region");
  expect(title.closest("header")).toHaveAttribute("data-tauri-drag-region");
  expect(screen.getByRole("button", { name: "启动网络" })).not.toHaveAttribute(
    "data-tauri-drag-region",
  );
  view.unmount();
});
it("keeps lifecycle failures visible in the sidebar and offers retry", async () => {
  vi.mocked(invoke).mockImplementation(async (_cmd, p: any) => {
    if (p.action === "snapshot") return structuredClone(snapshot);
    throw { message: "fixture startup failure" };
  });
  const view = mount();
  const button = await screen.findByRole("button", { name: "启动网络" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "fixture startup failure",
  );
  expect(screen.getByTestId("secondary-navigation")).toContainElement(
    screen.getByRole("alert"),
  );
  expect(button).toBeEnabled();
  view.unmount();
});

it("does not automatically repeat a denied settings read and permits an explicit retry", async () => {
  vi.mocked(invoke).mockRejectedValue({
    message: "credential authorization unavailable",
  });
  const view = mount();
  const retry = await screen.findByRole("button", { name: "重试读取配置" });
  const calls = vi.mocked(invoke).mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  expect(invoke).toHaveBeenCalledTimes(calls);
  vi.mocked(invoke).mockResolvedValue(structuredClone(snapshot));
  fireEvent.click(retry);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "preferences.reload",
      args: {},
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "启动网络" })).toBeEnabled(),
  );
  view.unmount();
});

it("keeps failed initialization explicit and retries the backend before the snapshot", async () => {
  let ready = false;
  let attempts = 0;
  const actions: string[] = [];
  vi.mocked(invoke).mockImplementation(async (_cmd, p: any) => {
    actions.push(p.action);
    if (p.action === "preferences.reload") {
      if (++attempts === 1) throw { message: "fixture still unavailable" };
      ready = true;
      return { ready: true };
    }
    if (p.action === "snapshot") {
      if (!ready) throw new Error("initialization failed");
      return structuredClone(snapshot);
    }
    return {};
  });
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "重试读取配置" }));
  await waitFor(() =>
    expect(
      within(screen.getByTestId("network-control")).getByRole("alert"),
    ).toHaveTextContent("fixture still unavailable"),
  );
  expect(attempts).toBe(1);
  expect(screen.getByRole("button", { name: "启动网络" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重试读取配置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "启动网络" })).toBeEnabled(),
  );
  expect(actions.lastIndexOf("snapshot")).toBeGreaterThan(
    actions.lastIndexOf("preferences.reload"),
  );
  view.unmount();
});

it("offers retry after a refresh fails even when an older snapshot is cached", async () => {
  let reads = 0;
  vi.mocked(invoke).mockImplementation(async (_cmd, p: any) => {
    if (p.action === "snapshot") {
      if (++reads === 2) throw new Error("transient snapshot failure");
      return structuredClone(snapshot);
    }
    return {};
  });
  const view = mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "启动网络" })).toBeEnabled(),
  );
  const retry = await screen.findByRole(
    "button",
    { name: "重试读取配置" },
    { timeout: 4000 },
  );
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "重试读取配置" }),
    ).not.toBeInTheDocument(),
  );
  expect(reads).toBeGreaterThanOrEqual(3);
  view.unmount();
});
