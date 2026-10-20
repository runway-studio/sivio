import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SyncPrivacySection } from "@/components/settings/SyncPrivacySection";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
let privacy = {
  includeSecrets: false,
  passwordConfigured: false,
  rememberPassword: false,
};
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SyncPrivacySection />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  privacy = {
    includeSecrets: false,
    passwordConfigured: false,
    rememberPassword: false,
  };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, options: any) => {
    if (options.action === "sync.privacy.get") return { ...privacy };
    if (options.action === "sync.privacy.save") {
      privacy = {
        ...privacy,
        includeSecrets: options.args.includeSecrets,
        passwordConfigured: true,
        rememberPassword: options.args.rememberPassword,
      };
      return { saved: true };
    }
    if (options.action === "backup.preview")
      return {
        filePath: "/tmp/fixture.siassist",
        revision: "fixture-digest",
        device: "Fixture Mac",
        createdAt: "2026-10-15T00:00:00Z",
        encrypted: true,
      };
    return { restored: true };
  });
});
describe("SyncPrivacySection", () => {
  it("requires saving explicit privacy and password-storage choices before export", async () => {
    mount();
    const exportButton = screen.getByRole("button", {
      name: "Export configuration bundle",
    });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(
      screen.getByLabelText(
        "Include credentials and encrypt the snapshot before upload",
      ),
    );
    fireEvent.change(screen.getByLabelText("Backup encryption password"), {
      target: { value: "fixture-backup-password" },
    });
    expect(exportButton).toBeDisabled();
    expect(
      screen.getByLabelText(
        "Remember the password in local configuration (readable by processes with file access)",
      ),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save sync privacy" }));
    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(invoke).toHaveBeenCalledWith("network_command", {
      action: "sync.privacy.save",
      args: {
        includeSecrets: true,
        rememberPassword: false,
        password: "fixture-backup-password",
      },
    });
    expect(screen.getByLabelText("Backup encryption password")).toHaveValue("");
  });
  it("previews a selected bundle and only restores after the user chooses that revision", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Select backup and preview" }),
    );
    await screen.findByText("/tmp/fixture.siassist");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([, options]: any) => options.action === "backup.restore",
        ),
    ).toBe(false);
    const restore = screen.getByRole("button", { name: "Restore this backup" });
    await waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(restore);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("network_command", {
        action: "backup.restore",
        args: expect.objectContaining({
          filePath: "/tmp/fixture.siassist",
          revision: "fixture-digest",
        }),
      }),
    );
  });
  it("does not restore a cancelled preview", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: "Select backup and preview" }),
    );
    await screen.findByText("/tmp/fixture.siassist");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("button", { name: "Restore this backup" }),
    ).not.toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([, options]: any) => options.action === "backup.restore",
        ),
    ).toBe(false);
  });
});
