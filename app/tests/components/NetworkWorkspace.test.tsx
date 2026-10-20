import { useRef, useState } from "react";
import type { NetworkTab } from "@/lib/navigation";
import i18n from "i18next";
import { act } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { emitTauriEvent } from "../msw/tauriMocks";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NetworkWorkspace } from "@/components/network/NetworkWorkspace";
import { hasPendingMutation, hasUnsavedChanges } from "@/lib/unsavedChanges";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/components/JsonEditor", () => ({
  default: ({ value, onChange, ariaLabel, readOnly }: any) => (
    <textarea
      aria-label={ariaLabel ?? "yaml"}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
let snapshot: any;
beforeEach(() => {
  snapshot = {
    settingsRevision: "revision-1",
    helper: { build_version: "2.7.6" },
    helperCompatible: false,
    runtime: { phase: "stopped", generation: 0, error: null },
    catalog: {
      profiles: [],
      active: null,
      outbound: "direct",
      settings: {
        mixedPort: 15722,
        httpPort: 0,
        socksPort: 0,
        redirPort: 0,
        mode: "rule",
        core: "stable",
        tun: false,
        systemProxy: false,
        proxyMode: "global",
        pacPort: 15723,
        pacScript: "",
        bypass: "",
        allowLan: false,
        lanUsername: "",
        lanPassword: "",
        merge: "{}",
        script: "",
        rules: "{}",
        proxies: "{}",
        groups: "{}",
        dns: "{}",
        latencyUrl: "https://example.com",
        latencyTimeout: 1000,
        autoDelayMinutes: 0,
        closeConnectionsOnSwitch: false,
      },
    },
  };
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (_command, args: any) => {
      if (args.action === "snapshot") return structuredClone(snapshot);
      return {};
    });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("zh");
});
function mount() {
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NetworkWorkspace />
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /^(订阅|Subscriptions)$/ }),
  );
  return view;
}
it("keeps independent network drafts on cancelled close and discards only that panel", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  fireEvent.click(await screen.findByRole("button", { name: /端口设置/ }));
  const port = screen.getByLabelText("混合代理端口");
  fireEvent.change(port, { target: { value: "7890" } });
  expect(hasUnsavedChanges()).toBe(true);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(port).toHaveValue(7890);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(hasUnsavedChanges()).toBe(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /端口设置/ }));
  expect(screen.getByLabelText("混合代理端口")).toHaveValue(15722);
  expect(invoke).not.toHaveBeenCalledWith(
    "network_command",
    expect.objectContaining({ action: "settings.save" }),
  );
  view.unmount();
});
it("pins a settings save to its snapshot revision and keeps navigation blocked until persistence finishes", async () => {
  let resolveSave: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "settings.save")
      await new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
    return {};
  });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  fireEvent.click(await screen.findByRole("button", { name: "测速与连接" }));
  const latency = await screen.findByLabelText("默认测速地址");
  fireEvent.change(latency, {
    target: { value: "https://changed.example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() => expect(resolveSave).toBeDefined());
  expect(hasPendingMutation()).toBe(true);
  expect(latency).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(screen.getByLabelText("默认测速地址")).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "settings.save",
    args: {
      settings: expect.objectContaining({
        latencyUrl: "https://changed.example.com",
      }),
      baseRevision: "revision-1",
    },
  });
  resolveSave!();
  await waitFor(() => expect(hasPendingMutation()).toBe(false));
  view.unmount();
  expect(hasUnsavedChanges()).toBe(false);
});

it("saves a live port change without a manual stop and protects the in-flight draft", async () => {
  snapshot.runtime = { phase: "running", generation: 7, port: 15722 };
  let finish: (() => void) | undefined;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "settings.save") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      snapshot.catalog.settings = args.args.settings;
      snapshot.settingsRevision = "revision-2";
      snapshot.runtime.port = args.args.settings.mixedPort;
      return { saved: true, restarted: true };
    }
    return {};
  });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  fireEvent.click(await screen.findByRole("button", { name: /端口设置/ }));
  const port = screen.getByLabelText("混合代理端口");
  expect(port).toBeEnabled();
  fireEvent.change(port, { target: { value: "27891" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(port).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(hasPendingMutation()).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith(
    "network_command",
    expect.objectContaining({ action: "stop" }),
  );
  finish!();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(snapshot.runtime.port).toBe(27891);
  view.unmount();
});

it("keeps a failed live settings draft, refreshes runtime and retries with the current revision", async () => {
  snapshot.runtime = { phase: "running", generation: 7, port: 15722 };
  let attempts = 0;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "settings.save") {
      attempts++;
      if (attempts === 1) {
        snapshot.runtime.generation = 9;
        snapshot.settingsRevision = "revision-after-recovery";
        throw new Error("应用失败；旧配置保持不变，旧网络已恢复");
      }
      return { saved: true, restarted: true };
    }
    return {};
  });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  fireEvent.click(await screen.findByRole("button", { name: /端口设置/ }));
  fireEvent.change(screen.getByLabelText("混合代理端口"), {
    target: { value: "27892" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await screen.findByText("应用失败；旧配置保持不变，旧网络已恢复");
  expect(screen.getByLabelText("混合代理端口")).toHaveValue(27892);
  expect(hasUnsavedChanges()).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(invoke).toHaveBeenLastCalledWith("network_command", expect.anything());
  expect(
    vi
      .mocked(invoke)
      .mock.calls.filter(
        ([, args]: any) => args.action === "settings.save",
      )[1][1],
  ).toMatchObject({
    args: {
      baseRevision: "revision-after-recovery",
      settings: { mixedPort: 27892 },
    },
  });
  view.unmount();
});

it("switches critical network labels to English while preserving user profile names", async () => {
  await i18n.changeLanguage("en");
  snapshot.catalog.profiles = [
    {
      id: "user",
      name: "我的中文订阅",
      kind: "local",
      revision: "r",
      updated: 1,
      interval: 0,
    },
  ];
  const view = mount();
  expect(
    await screen.findByRole("heading", { name: "Network workspace" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "我的中文订阅" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    await screen.findByRole("heading", { name: "Clash network settings" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("AI outbound route")).not.toBeInTheDocument();
  expect(screen.getByText(/Update \/ repair required/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Install / repair service" }),
  ).toBeInTheDocument();
  view.unmount();
});

it("allows live DNS editing and on-demand service preparation from a warm core", async () => {
  await i18n.changeLanguage("en");
  snapshot.runtime = { phase: "running", generation: 4, port: 15722 };
  snapshot.catalog.settings.dnsOverride = true;
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(
    await screen.findByRole("button", { name: "Install / repair service" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: /DNS override/ }));
  const dns = screen.getByLabelText("DNS configuration");
  expect(dns).not.toHaveAttribute("readonly");
  fireEvent.change(dns, { target: { value: "enable: false" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and apply" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "settings.save",
      args: {
        settings: expect.objectContaining({ dns: "enable: false" }),
        baseRevision: "revision-1",
      },
    }),
  );
  view.unmount();
});

it("does not rebase an old draft onto an external settings edit after a conflict", async () => {
  snapshot.runtime = { phase: "running", generation: 4, port: 15722 };
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "settings.save") {
      snapshot.catalog.settings.mixedPort = 28888;
      snapshot.settingsRevision = "external-revision";
      throw new Error("network settings changed; reload before saving");
    }
    return {};
  });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  fireEvent.click(await screen.findByRole("button", { name: /端口设置/ }));
  fireEvent.change(screen.getByLabelText("混合代理端口"), {
    target: { value: "27893" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await screen.findByText("network settings changed; reload before saving");
  expect(screen.getByLabelText("混合代理端口")).toHaveValue(27893);
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([, args]: any) => args.action === "settings.save"),
    ).toHaveLength(2),
  );
  const saves = vi
    .mocked(invoke)
    .mock.calls.filter(([, args]: any) => args.action === "settings.save");
  expect(saves[1][1]).toMatchObject({ args: { baseRevision: "revision-1" } });
  view.unmount();
});

it("refreshes a failed lease while background interval sampling is paused", async () => {
  snapshot.runtime = {
    phase: "running",
    generation: 1,
    error: null,
    port: 15722,
    managed: true,
  };
  const view = mount();
  await screen.findByRole("button", { name: "停止" });
  focusManager.setFocused(false);
  try {
    snapshot.runtime = {
      phase: "failed",
      generation: 1,
      error: "fixture lease expired",
      port: null,
      managed: true,
    };
    await act(async () => emitTauriEvent("network-runtime-changed", null));
    expect(
      await screen.findByText("fixture lease expired"),
    ).toBeInTheDocument();
  } finally {
    view.unmount();
    focusManager.setFocused(true);
  }
});

it("routes secondary navigation through the shell guard without duplicate tabs", async () => {
  let leave: (() => void) | undefined;
  const requestLeave = vi.fn((proceed: () => void) => {
    leave = proceed;
  });
  function Shell() {
    const [tab, setTab] = useState<NetworkTab>("设置");
    const navigation = useRef<((tab: NetworkTab) => void) | null>(null);
    return (
      <>
        <button onClick={() => navigation.current?.("订阅")}>
          shell subscriptions
        </button>
        <NetworkWorkspace
          selectedTab={tab}
          onTabChange={setTab}
          navigationRef={navigation}
          requestLeave={requestLeave}
        />
      </>
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "测速与连接" }));
  const latency = await screen.findByLabelText("默认测速地址");
  await waitFor(() => expect(hasPendingMutation()).toBe(false));
  fireEvent.change(latency, { target: { value: "https://draft.example" } });
  expect(hasUnsavedChanges()).toBe(true);
  expect(
    screen.queryByRole("navigation", { name: "网络导航" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("shell subscriptions"));
  expect(requestLeave).toHaveBeenCalledOnce();
  expect(latency).toHaveValue("https://draft.example");
  act(() => leave?.());
  expect(screen.getByRole("heading", { name: "订阅" })).toBeInTheDocument();
  expect(hasUnsavedChanges()).toBe(false);
  const query = client
    .getQueryCache()
    .find({ queryKey: ["network", "snapshot"] });
  expect(query?.getObserversCount()).toBe(1);
  view.unmount();
  expect(query?.getObserversCount()).toBe(0);
  expect(hasPendingMutation()).toBe(false);
});

it("opens a remote subscription dialog with simple defaults and validates before downloading", async () => {
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
  expect(screen.getByRole("dialog", { name: "添加订阅" })).toBeInTheDocument();
  expect(screen.getByLabelText("配置来源")).toHaveValue("remote");
  expect(screen.getByLabelText("自动更新间隔")).toHaveValue(1440);
  expect(screen.getByLabelText("订阅地址")).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请填写配置名称");
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "My network" },
  });
  fireEvent.change(screen.getByLabelText("订阅地址"), {
    target: { value: "file:///test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  expect(screen.getByRole("alert")).toHaveTextContent("HTTP 或 HTTPS");
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "subscription.fetch"),
  ).toBe(false);
  view.unmount();
});

it("downloads the current URL before saving, holds the dialog during work and closes only on success", async () => {
  let resolveFetch!: (value: any) => void;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "subscription.fetch")
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    return {};
  });
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "  Daily  " },
  });
  fireEvent.change(screen.getByLabelText("订阅地址"), {
    target: { value: " https://example.test/feed?token=secret " },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  await waitFor(() => expect(resolveFetch).toBeDefined());
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(hasPendingMutation()).toBe(true);
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "profile.save"),
  ).toBe(false);
  await act(async () => resolveFetch({ yaml: "proxies: []\nrules: []" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "profile.save",
    args: expect.objectContaining({
      name: "Daily",
      url: "https://example.test/feed?token=secret",
      kind: "remote",
      yaml: "proxies: []\nrules: []",
      interval: 1440,
    }),
  });
  expect(hasPendingMutation()).toBe(false);
  view.unmount();
});

it("keeps a failed import draft, redacts the URL and allows retry", async () => {
  let fail = true;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "subscription.fetch") {
      if (fail)
        throw new Error("Failed https://example.test/feed?token=secret");
      return { yaml: "proxies: []" };
    }
    return {};
  });
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "Daily" },
  });
  fireEvent.change(screen.getByLabelText("订阅地址"), {
    target: { value: "https://example.test/feed?token=secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("secret");
  expect(screen.getByLabelText("配置名称")).toHaveValue("Daily");
  expect(hasPendingMutation()).toBe(false);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  view.unmount();
});

it("protects a dirty dialog on cancel and supports local configuration without a download", async () => {
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "Local" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("配置来源"), {
    target: { value: "local" },
  });
  fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "subscription.fetch"),
  ).toBe(false);
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "profile.save",
    args: expect.objectContaining({ name: "Local", kind: "local" }),
  });
  view.unmount();
});

it("validates update intervals and refetches when the subscription address changes", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "subscription.fetch")
      return { yaml: `# ${args.args.url}\nproxies: []` };
    return {};
  });
  const view = mount();
  fireEvent.click(await screen.findByRole("button", { name: "添加订阅" }));
  fireEvent.change(screen.getByLabelText("配置名称"), {
    target: { value: "Daily" },
  });
  fireEvent.change(screen.getByLabelText("订阅地址"), {
    target: { value: "https://example.test/first" },
  });
  fireEvent.change(screen.getByLabelText("自动更新间隔"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  expect(screen.getByRole("alert")).toHaveTextContent("5–43200");
  fireEvent.click(screen.getByRole("switch", { name: "允许自动更新" }));
  fireEvent.click(screen.getByText("配置正文与预览"));
  fireEvent.click(screen.getByRole("button", { name: "获取" }));
  await waitFor(() =>
    expect(screen.getByText("订阅已获取，请检查后保存")).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("订阅地址"), {
    target: { value: "https://example.test/second" },
  });
  fireEvent.click(screen.getByRole("button", { name: "导入订阅" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "profile.save",
    args: expect.objectContaining({
      url: "https://example.test/second",
      yaml: "# https://example.test/second\nproxies: []",
      interval: 0,
    }),
  });
  view.unmount();
});

it("saves only the chosen network panel and leaves model egress untouched", async () => {
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  expect(
    await screen.findByRole("heading", { name: "Clash 网络设置" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("AI 出站策略")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /端口设置/ }));
  fireEvent.change(screen.getByLabelText("混合代理端口"), {
    target: { value: "7890" },
  });
  fireEvent.click(screen.getByRole("switch", { name: "SOCKS 代理端口 启用" }));
  expect(screen.getByLabelText("SOCKS 代理端口")).toHaveValue(7898);
  fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "settings.save",
    args: {
      baseRevision: "revision-1",
      settings: expect.objectContaining({
        mixedPort: 7890,
        socksPort: 7898,
        dns: "{}",
        core: "stable",
      }),
    },
  });
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "outbound.set"),
  ).toBe(false);
  view.unmount();
});

it("keeps port failures visible without suggesting unrelated service repair", async () => {
  snapshot.catalog.settings.systemProxy = true;
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "snapshot") return structuredClone(snapshot);
    if (args.action === "start")
      throw new Error(
        "mixed port is occupied; existing process was left untouched",
      );
    return {};
  });
  const view = mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "启动网络" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "启动网络" }));
  expect(
    await screen.findByText(
      "mixed port is occupied; existing process was left untouched",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "安装 / 修复服务" }),
  ).not.toBeInTheDocument();
  view.unmount();
});

it("keeps the core running after an external proxy edit and reapplies without restarting", async () => {
  snapshot.runtime = {
    phase: "running",
    generation: 42,
    port: 7891,
    managed: true,
    proxyGuardTripped: true,
    error: null,
  };
  snapshot.helperAuthorized = true;
  snapshot.helperCompatible = true;
  snapshot.catalog.settings.systemProxy = true;
  const view = mount();
  expect(await screen.findByText(/Sivio 内核已就绪/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "停止" })).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新应用系统代理" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "proxy.reapply",
      args: { expectedGeneration: 42 },
    }),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) =>
        ["start", "stop"].includes(args.action),
      ),
  ).toBe(false);
  view.unmount();
});

it("does not show an old proxy ownership warning when the core is stopped", async () => {
  snapshot.runtime.proxyGuardTripped = true;
  const view = mount();
  await screen.findByRole("button", { name: "启动网络" });
  expect(
    screen.queryByRole("button", { name: "重新应用系统代理" }),
  ).not.toBeInTheDocument();
  view.unmount();
});

it("offers upgrade for an already authorized but incompatible helper", async () => {
  snapshot.helperAuthorized = true;
  snapshot.helperCompatible = false;
  snapshot.catalog.settings.systemProxy = true;
  snapshot.runtime.error = "网络服务需要升级";
  const view = mount();
  expect(
    await screen.findByText(
      "系统代理与 TUN 需要兼容的 Sivio 服务，请先安装或修复。",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "安装 / 修复服务" })).toBeEnabled();
  view.unmount();
});

it("does not show service setup during normal prepared-core use", async () => {
  snapshot.catalog.settings.systemProxy = true;
  snapshot.helperCompatible = false;
  snapshot.helperAuthorized = false;
  snapshot.runtime = {
    ...snapshot.runtime,
    phase: "running",
    managed: false,
    error: null,
    proxyGuardTripped: true,
  };
  const view = mount();
  await screen.findByRole("button", { name: "停止" });
  expect(
    screen.queryByRole("button", { name: "安装 / 修复服务" }),
  ).not.toBeInTheDocument();
  view.unmount();
});

it("asks to reopen a replaced running app instead of reinstalling its helper", async () => {
  snapshot.helperCompatible = true;
  snapshot.helperAuthorized = false;
  snapshot.appRestartRequired = true;
  snapshot.catalog.settings.systemProxy = true;
  snapshot.runtime.phase = "failed";
  snapshot.runtime.error = "helper stop failed: caller signature is not trusted";
  const view = mount();
  expect(await screen.findByText(
    "Sivio 运行期间 App 文件已被替换，请完全退出后打开新版 App，再启用网络。",
  )).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "安装 / 修复服务" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "设置" }));
  await screen.findByText(/需要重新打开 App/);
  expect(screen.queryByRole("button", { name: "安装 / 修复服务" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "卸载服务" })).toBeDisabled();
  expect(vi.mocked(invoke).mock.calls.some(([, args]: any) => args.action === "helper.install")).toBe(false);
  view.unmount();
});

it("still offers registration when an intact app is not trusted", async () => {
  snapshot.helperCompatible = true;
  snapshot.helperAuthorized = false;
  snapshot.appRestartRequired = false;
  snapshot.catalog.settings.systemProxy = true;
  snapshot.runtime.error = "helper stop failed: caller signature is not trusted";
  const view = mount();
  expect(await screen.findByRole("button", { name: "安装 / 修复服务" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "安装 / 修复服务" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("network_command", { action: "helper.install", args: {} }));
  view.unmount();
});

it("activates a prepared ordinary core through the settings transaction", async () => {
  snapshot.catalog.settings.systemProxy = true;
  snapshot.runtime = {
    phase: "running",
    generation: 5,
    managed: false,
    proxyGuardTripped: true,
    port: 7891,
    error: null,
  };
  const view = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "重新应用系统代理" }),
  );
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "settings.save",
      args: {
        settings: snapshot.catalog.settings,
        baseRevision: "revision-1",
        startIfStopped: true,
        takeOverProxy: true,
      },
    }),
  );
  expect(
    vi
      .mocked(invoke)
      .mock.calls.some(([, args]: any) => args.action === "proxy.reapply"),
  ).toBe(false);
  view.unmount();
});
