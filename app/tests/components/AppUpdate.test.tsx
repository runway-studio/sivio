import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AboutSection } from "@/components/settings/AboutSection";
import { UpdateProvider } from "@/contexts/UpdateContext";
import { settingsApi } from "@/lib/api";
const fixtures = vi.hoisted(() => ({
  events: new Map<string, (event: any) => void>(),
  autoCheckUpdate: false,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, callback) => {
    fixtures.events.set(name, callback);
    return () => fixtures.events.delete(name);
  }),
}));
vi.mock("@/lib/desktopPreferences", () => ({
  useDesktopPreferences: () => ({
    data: { preferences: { autoCheckUpdate: fixtures.autoCheckUpdate } },
  }),
}));
vi.mock("@/lib/api", () => ({
  settingsApi: {
    downloadAppUpdate: vi.fn(),
    cancelAppUpdate: vi.fn(),
    installUpdateAndRestart: vi.fn(),
    openExternal: vi.fn(),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
const info = {
  candidateId: "candidate-1",
  currentVersion: "0.1.0",
  availableVersion: "0.2.0",
  notes: "Release notes",
};
let mode: string;
beforeEach(() => {
  localStorage.clear();
  fixtures.events.clear();
  fixtures.autoCheckUpdate = false;
  mode = "official";
  vi.mocked(settingsApi.downloadAppUpdate)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(settingsApi.cancelAppUpdate)
    .mockReset()
    .mockResolvedValue(undefined);
  vi.mocked(settingsApi.installUpdateAndRestart)
    .mockReset()
    .mockResolvedValue(true);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args: any) => {
      if (command === "check_app_update_info") return info;
      if (args?.action === "app.update.save") {
        mode = args.args.mode;
        return { saved: true };
      }
      return {
        mode,
        configured: mode !== "disabled",
        endpoint:
          "https://github.com/runway-studio/sivio/releases/latest/download/latest.json",
        publicKey: "public",
        releasePage: "https://github.com/runway-studio/sivio/releases",
        signingMode: "internal",
      };
    });
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <UpdateProvider>
        <AboutSection isPortable={false} />
      </UpdateProvider>
    </QueryClientProvider>,
  );
}
async function check() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  await screen.findByText("Release notes");
}
it("uses the official source and never downloads merely because a newer version exists", async () => {
  mount();
  await check();
  expect(screen.getByText(/Sivio official/)).toBeInTheDocument();
  expect(settingsApi.downloadAppUpdate).not.toHaveBeenCalled();
  expect(settingsApi.installUpdateAndRestart).not.toHaveBeenCalled();
});
it("binds progress and cancellation to the candidate and ignores a late download result", async () => {
  let finish!: () => void;
  vi.mocked(settingsApi.downloadAppUpdate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await check();
  fireEvent.click(screen.getByRole("button", { name: "Download update" }));
  await act(async () =>
    fixtures.events.get("update-download-progress")?.({
      payload: {
        candidateId: "other",
        stage: "ready",
        downloaded: 1,
        total: 1,
      },
    }),
  );
  expect(screen.queryByText("Download verified")).not.toBeInTheDocument();
  await act(async () =>
    fixtures.events.get("update-download-progress")?.({
      payload: {
        candidateId: "candidate-1",
        stage: "downloading",
        downloaded: 1048576,
        total: null,
      },
    }),
  );
  expect(screen.getByText("1.0 MB")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel update" }));
  await waitFor(() =>
    expect(settingsApi.cancelAppUpdate).toHaveBeenCalledWith("candidate-1"),
  );
  await act(async () => finish());
  expect(screen.queryByText("Release notes")).not.toBeInTheDocument();
  expect(settingsApi.installUpdateAndRestart).not.toHaveBeenCalled();
});
it("requires confirmation and the shared shell guard before installation", async () => {
  let proceed: (() => void) | undefined;
  const guard = (event: Event) => {
    proceed = (event as CustomEvent).detail;
  };
  window.addEventListener("sivio-install-update-request", guard);
  try {
    mount();
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Download update" }));
    await screen.findByText("Download verified");
    expect(settingsApi.downloadAppUpdate).toHaveBeenCalledWith("candidate-1");
    fireEvent.click(
      screen.getByRole("button", { name: "Install and restart" }),
    );
    await screen.findByRole("dialog");
    expect(settingsApi.installUpdateAndRestart).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Install and restart",
        hidden: false,
      }),
    );
    expect(proceed).toBeTypeOf("function");
    expect(settingsApi.installUpdateAndRestart).not.toHaveBeenCalled();
    await act(async () => proceed?.());
    expect(settingsApi.installUpdateAndRestart).toHaveBeenCalledWith(
      "candidate-1",
    );
  } finally {
    window.removeEventListener("sivio-install-update-request", guard);
  }
});
it("shows check failures and invalidates candidates when disabling updates", async () => {
  mount();
  await check();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Update channel", hidden: true }),
    { target: { value: "disabled" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save update settings", hidden: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeDisabled(),
  );
  expect(screen.queryByText("Release notes")).not.toBeInTheDocument();
});
it("does not turn a failed check into an up-to-date result", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "check_app_update_info")
      throw new Error("UPDATE_CHECK_FAILED: no published release");
    return {
      mode: "official",
      configured: true,
      endpoint: "https://example.org",
      publicKey: "public",
    };
  });
  mount();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no published release",
  );
  expect(settingsApi.downloadAppUpdate).not.toHaveBeenCalled();
});
