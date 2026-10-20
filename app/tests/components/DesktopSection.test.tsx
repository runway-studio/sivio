import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { DesktopSection } from "@/components/settings/DesktopSection";
import { defaultDesktopPreferences } from "@/lib/desktopPreferences";
import { hasUnsavedChanges } from "@/lib/unsavedChanges";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (_command, args: any) => {
      if (args.action === "desktop.get")
        return {
          preferences: { ...defaultDesktopPreferences },
          revision: "r1",
          registrationError: null,
        };
      if (args.action === "desktop.save")
        throw { message: "Shortcut conflict: key is occupied" };
      if (args.action === "desktop.reset")
        return {
          preferences: { ...defaultDesktopPreferences },
          revision: "r2",
          registrationError: null,
        };
      return {};
    });
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DesktopSection />
    </QueryClientProvider>,
  );
}
it("retains drafts and the original revision when native shortcut registration fails", async () => {
  const view = mount();
  const key = await screen.findByLabelText("显示 / 隐藏主窗口");
  await waitFor(() => expect(key).toBeEnabled());
  fireEvent.change(key, { target: { value: "Command+Shift+K" } });
  fireEvent.click(screen.getByLabelText("启用全局快捷键"));
  fireEvent.click(screen.getByRole("button", { name: "应用桌面设置" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Shortcut conflict",
  );
  expect(key).toHaveValue("Command+Shift+K");
  expect(hasUnsavedChanges()).toBe(true);
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "desktop.save",
    args: {
      revision: "r1",
      preferences: expect.objectContaining({
        globalShortcutsEnabled: true,
        hotkeys: { open_or_close_dashboard: "Command+Shift+K" },
      }),
    },
  });
  view.unmount();
  expect(hasUnsavedChanges()).toBe(false);
});
it("can recover invalid stored preferences without needing a successful initial read", async () => {
  vi.mocked(invoke).mockImplementation(async (_command, args: any) => {
    if (args.action === "desktop.get")
      throw new Error("Desktop preferences are invalid");
    return {
      preferences: { ...defaultDesktopPreferences },
      revision: "reset",
      registrationError: null,
    };
  });
  const view = mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("invalid");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "恢复默认桌面设置" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "desktop.reset",
      args: {},
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  confirm.mockRestore();
  view.unmount();
});

it("routes immediate lightweight entry through the shared draft guard", async () => {
  const view = mount();
  await screen.findByLabelText("启用全局快捷键");
  fireEvent.click(screen.getByRole("button", { name: "立即进入轻量模式" }));
  await waitFor(() =>
    expect(emit).toHaveBeenCalledWith("lightweight-requested", {
      automatic: false,
    }),
  );
  view.unmount();
});
