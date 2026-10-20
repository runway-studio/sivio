import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ThemeProvider } from "@/components/theme-provider";
import { defaultAppearance, validateAppearance } from "@/lib/appearance";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, options: any) => {
    if (options?.action === "appearance.get")
      return {
        preferences: { ...defaultAppearance, css: "body{display:none}" },
        revision: "old",
      };
    if (options?.action === "appearance.reset")
      return { preferences: { ...defaultAppearance }, revision: "reset" };
    return false;
  });
});
afterEach(() => {
  document.querySelector("#si-assist-appearance")?.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ThemeProvider>
        <div>recovered interface</div>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
it("recovers from CSS hiding the whole page and persists defaults through the backend", async () => {
  const { unmount } = mount();
  await waitFor(() =>
    expect(
      document.querySelector("#si-assist-appearance")?.textContent,
    ).toContain("display:none"),
  );
  fireEvent.keyDown(window, {
    key: "Backspace",
    metaKey: true,
    shiftKey: true,
  });
  await waitFor(() =>
    expect(
      document.querySelector("#si-assist-appearance")?.textContent,
    ).not.toContain("display:none"),
  );
  expect(invoke).toHaveBeenCalledWith("network_command", {
    action: "appearance.reset",
    args: {},
  });
  unmount();
  expect(document.querySelector("#si-assist-appearance")).toBeNull();
});
it("does not accumulate recovery handlers across twenty window recreations", async () => {
  for (let count = 0; count < 20; count++) {
    const view = mount();
    await waitFor(() =>
      expect(
        document.querySelector("#si-assist-appearance")?.textContent,
      ).toContain("display:none"),
    );
    view.unmount();
  }
  const view = mount();
  await waitFor(() =>
    expect(
      document.querySelector("#si-assist-appearance")?.textContent,
    ).toContain("display:none"),
  );
  fireEvent.keyDown(window, {
    key: "Backspace",
    ctrlKey: true,
    shiftKey: true,
  });
  await waitFor(() =>
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(
          ([, options]: any) => options?.action === "appearance.reset",
        ),
    ).toHaveLength(1),
  );
  view.unmount();
});
it("rejects remote CSS resources and escaped imports before they can be applied", () => {
  for (const css of [
    "@import 'remote.css';",
    "body{background:URL(//example.invalid)}",
    String.raw`body{background:u\72l(secret)}`,
    "body{background:-webkit-image-set('remote.png' 1x)}",
  ])
    expect(() => validateAppearance({ ...defaultAppearance, css })).toThrow();
});
