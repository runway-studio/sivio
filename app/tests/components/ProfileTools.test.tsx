import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ProfileTools } from "@/components/network/ProfileTools";
import { networkApi } from "@/components/network/networkApi";
vi.mock("@/components/network/networkApi", () => ({ networkApi: vi.fn() }));
vi.mock("@/components/JsonEditor", () => ({
  default: ({ value, onChange, ariaLabel }: any) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
let snapshot: any;
let payload: any;
beforeEach(() => {
  snapshot = {
    settingsRevision: "settings-1",
    runtime: { phase: "running", active: "p1" },
    catalog: {
      active: "p1",
      settings: {
        merge: "{}",
        script: "",
        rules: "prepend: []\nappend: []\ndelete: []",
      },
      profiles: [
        {
          id: "p1",
          name: "测试订阅",
          kind: "remote",
          revision: "r1",
          interval: 1440,
        },
      ],
    },
  };
  payload = {
    yaml: 'proxies: []\nproxy-groups: [{name: 代理, type: select, proxies: [DIRECT]}]\nrules: ["MATCH,DIRECT"]',
    url: "https://example.invalid/fixture",
    requestOptions: { via: "direct" },
    enhancement: {
      enabled: false,
      merge: "{}",
      script: "",
      rules: "prepend: []\nappend: []\ndelete: []",
      proxies: "prepend: []\nappend: []\ndelete: []",
      groups: "prepend: []\nappend: []\ndelete: []",
      dnsMode: "inherit",
      dns: "{}",
      importedGlobal: { merge: "fixture: retained" },
    },
  };
  vi.mocked(networkApi)
    .mockReset()
    .mockImplementation(async (action: any) =>
      action === "snapshot"
        ? structuredClone(snapshot)
        : action === "profile.read"
          ? structuredClone(payload)
          : {},
    );
});
function mount(global = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProfileTools
        snapshot={snapshot}
        profile={global ? undefined : snapshot.catalog.profiles[0]}
      />
    </QueryClientProvider>,
  );
}
async function choose(name: string) {
  await userEvent.click(
    screen.getByRole("button", { name: "订阅操作 测试订阅" }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name }));
}
it("exposes the requested menu and saves a rule overlay with revision and unrelated payload preserved", async () => {
  mount();
  await choose("编辑规则");
  await screen.findByLabelText("规则内容");
  fireEvent.change(screen.getByLabelText("规则内容"), {
    target: { value: "gitlab.example.com" },
  });
  fireEvent.click(screen.getByText("添加前置规则"));
  fireEvent.click(screen.getByRole("button", { name: "保存并应用" }));
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith(
      "profile.save",
      expect.objectContaining({
        baseRevision: "r1",
        url: payload.url,
        enhancement: expect.objectContaining({
          enabled: true,
          importedGlobal: { merge: "fixture: retained" },
          rules: expect.stringContaining("DOMAIN,gitlab.example.com,DIRECT"),
        }),
      }),
    ),
  );
});
it("keeps the draft and dialog after a save conflict", async () => {
  vi.mocked(networkApi).mockImplementation(async (action: any) => {
    if (action === "profile.save")
      throw new Error("profile changed externally");
    return action === "snapshot"
      ? snapshot
      : action === "profile.read"
        ? payload
        : {};
  });
  mount();
  await choose("编辑文件");
  await screen.findByLabelText("编辑文件");
  fireEvent.change(screen.getByLabelText("编辑文件"), {
    target: { value: 'rules: ["MATCH,REJECT"]' },
  });
  fireEvent.click(screen.getByText("保存并应用"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed externally",
  );
  expect(screen.getByLabelText("编辑文件")).toHaveValue(
    'rules: ["MATCH,REJECT"]',
  );
});
it("explicit refresh selects direct or current core without overwriting saved route", async () => {
  mount();
  await choose("更新");
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith("profile.update", {
      id: "p1",
      via: "direct",
    }),
  );
  await choose("更新（代理）");
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith("profile.update", {
      id: "p1",
      via: "managed-network",
    }),
  );
});
it("opens a QR locally and provides a global merge editor", async () => {
  const view = mount();
  await choose("分享二维码");
  expect(await screen.findByText("复制订阅链接")).toBeInTheDocument();
  expect(
    view.container.ownerDocument.querySelector("svg title"),
  ).toHaveTextContent("订阅地址二维码");
  view.unmount();
  mount(true);
  await userEvent.click(screen.getByText("全局扩展覆写配置"));
  await screen.findByLabelText("扩展覆写配置");
  fireEvent.change(screen.getByLabelText("扩展覆写配置"), {
    target: { value: "unified-delay: true" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith(
      "settings.save",
      expect.objectContaining({
        baseRevision: "settings-1",
        settings: expect.objectContaining({ merge: "unified-delay: true" }),
      }),
    ),
  );
});

it("previews global draft settings against the active subscription", async () => {
  vi.mocked(networkApi).mockImplementation(async (action: any) =>
    action === "snapshot"
      ? snapshot
      : action === "profile.read"
        ? payload
        : { yaml: payload.yaml },
  );
  mount(true);
  await userEvent.click(screen.getByText("全局扩展覆写配置"));
  fireEvent.change(await screen.findByLabelText("扩展覆写配置"), {
    target: { value: "unified-delay: true" },
  });
  fireEvent.click(screen.getByText("预览生效配置"));
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith(
      "preview",
      expect.objectContaining({
        yaml: payload.yaml,
        settings: expect.objectContaining({ merge: "unified-delay: true" }),
        enhancement: payload.enhancement,
      }),
    ),
  );
});
it("imports an external working copy only on explicit read-back then validated save", async () => {
  vi.mocked(networkApi).mockImplementation(async (action: any) =>
    action === "snapshot"
      ? snapshot
      : action === "profile.read"
        ? payload
        : action === "profile.file.read"
          ? { yaml: 'rules: ["MATCH,REJECT"]' }
          : {},
  );
  mount();
  await choose("打开文件");
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith("profile.file.open", {
      id: "p1",
      baseRevision: "r1",
    }),
  );
  expect(networkApi).not.toHaveBeenCalledWith(
    "profile.save",
    expect.anything(),
  );
  fireEvent.click(screen.getByText("读取外部修改"));
  await waitFor(() =>
    expect(screen.getByLabelText("编辑文件")).toHaveValue(
      'rules: ["MATCH,REJECT"]',
    ),
  );
  fireEvent.click(screen.getByText("保存并应用"));
  await waitFor(() =>
    expect(networkApi).toHaveBeenCalledWith(
      "profile.save",
      expect.objectContaining({
        yaml: 'rules: ["MATCH,REJECT"]',
        baseRevision: "r1",
      }),
    ),
  );
});
