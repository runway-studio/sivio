import { getVersion } from "@tauri-apps/api/app";

export type UpdateChannel = "stable" | "beta";

export interface UpdateInfo {
  candidateId: string;
  currentVersion: string;
  availableVersion: string;
  notes?: string;
  pubDate?: string;
}

export interface CheckOptions {
  timeout?: number;
  channel?: UpdateChannel;
}

export async function getCurrentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "";
  }
}

export async function checkForUpdate(
  opts: CheckOptions = {},
): Promise<
  { status: "up-to-date" } | { status: "available"; info: UpdateInfo }
> {
  const { invoke } = await import("@tauri-apps/api/core");
  const info = await invoke<UpdateInfo | null>("check_app_update_info", {
    timeout: opts.timeout ?? 30000,
  });
  return info ? { status: "available", info } : { status: "up-to-date" };
}

export interface UpdateProgress {
  candidateId: string;
  stage:
    | "downloading"
    | "verifying"
    | "ready"
    | "installing"
    | "restarting"
    | "error";
  downloaded: number;
  total: number | null;
}
