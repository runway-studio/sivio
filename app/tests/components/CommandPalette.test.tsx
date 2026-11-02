import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { createTestQueryClient } from "../utils/testQueryClient";
const locale = vi.hoisted(() => ({ language: "en" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: locale }) }));
vi.mock("@/lib/query", () => ({
  providersQueryOptions: (app: string) => ({
    queryKey: ["providers", app],
    queryFn: async () => ({
      providers: {
        p: {
          id: "p",
          name: `Provider ${app}`,
          settingsConfig: { token: "DO_NOT_INDEX_TOKEN" },
          notes: "DO_NOT_INDEX_NOTE",
        },
      },
    }),
  }),
}));
vi.mock("@/lib/api/model-hub", () => ({
  modelHubApi: {
    catalog: async () => ({
      providers: [{ id: "p", name: "Provider", models: ["fixture-model"] }],
      mode: "direct",
      revision: "r",
    }),
  },
}));
vi.mock("@/lib/api/sessions", () => ({
  sessionsApi: {
    list: async () => [
      {
        providerId: "claude",
        sessionId: "s",
        title: "Session title",
        summary: "DO_NOT_INDEX_PROMPT",
        sourcePath: "DO_NOT_INDEX_PATH",
        lastActiveAt: 1,
      },
    ],
  },
}));
vi.mock("@/components/network/networkApi", () => ({
  networkApi: async () => ({
    proxies: { "Fixture node": { password: "DO_NOT_INDEX_NODE" } },
  }),
}));
beforeEach(() => {
  locale.language = "en";
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});
function mount(busy = () => false) {
  const select = vi.fn();
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <CommandPalette isBusy={busy} onSelect={select} />
    </QueryClientProvider>,
  );
  return select;
}
it("opens with Cmd+K, ignores composition, supports arrows/Enter and restores focus", async () => {
  const select = mount();
  const trigger = screen.getByRole("button", { name: "Search commands ⌘K" });
  trigger.focus();
  fireEvent.keyDown(window, { key: "k", metaKey: true, isComposing: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = await screen.findByRole("combobox");
  fireEvent.change(input, { target: { value: "Settings" } });
  await screen.findByRole("option", { name: "Settings" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(select).toHaveBeenCalledWith({ kind: "page", page: "settings" }),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("IME Enter cannot activate a result and Escape closes after composition", async () => {
  const select = mount();
  fireEvent.click(screen.getByRole("button"));
  const input = await screen.findByRole("combobox");
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("indexes metadata only and opens selected model drafts without writes", async () => {
  const select = mount();
  fireEvent.click(screen.getByRole("button"));
  const input = await screen.findByRole("combobox");
  await screen.findByText("Session title");
  for (const secret of [
    "DO_NOT_INDEX_TOKEN",
    "DO_NOT_INDEX_NOTE",
    "DO_NOT_INDEX_PROMPT",
    "DO_NOT_INDEX_PATH",
    "DO_NOT_INDEX_NODE",
  ]) {
    fireEvent.change(input, { target: { value: secret } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  }
  fireEvent.change(input, { target: { value: "fixture-model" } });
  const options = await screen.findAllByRole("option");
  fireEvent.click(options[0]);
  expect(select).toHaveBeenCalledWith({
    kind: "model",
    app: "claude",
    providerId: "p",
    model: "fixture-model",
  });
});
it("busy operations disable navigation and are checked again on selection", async () => {
  let busy = true;
  const select = mount(() => busy);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText(
    "Configuration is being saved; finish before navigating.",
  );
  expect(
    screen
      .queryAllByRole("option")
      .every((e) => e.getAttribute("data-disabled") === "true"),
  ).toBe(true);
  expect(select).not.toHaveBeenCalled();
  busy = false;
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Settings" },
  });
  await screen.findByRole("option", { name: "Settings" });
  busy = true;
  fireEvent.click(screen.getByRole("option", { name: "Settings" }));
  expect(select).not.toHaveBeenCalled();
});
it.each([
  ["en", 960, false],
  ["zh", 960, true],
  ["en", 1280, true],
  ["zh", 1280, false],
] as const)(
  "supports %s at %i pixels with dark=%s",
  async (language, width, dark) => {
    locale.language = language;
    vi.stubGlobal("innerWidth", width);
    document.documentElement.classList.toggle("dark", dark);
    const select = mount();
    fireEvent.click(screen.getByRole("button"));
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, {
      target: { value: language === "zh" ? "设置" : "Settings" },
    });
    fireEvent.click(
      await screen.findByRole("option", {
        name: language === "zh" ? "设置" : "Settings",
      }),
    );
    expect(select).toHaveBeenCalledWith({ kind: "page", page: "settings" });
  },
);
