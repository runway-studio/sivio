import { invoke } from "@tauri-apps/api/core";
export async function networkApi<T = Record<string, any>>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await invoke<T>("network_command", { action, args });
  } catch (error) {
    throw new Error(
      typeof error === "object" && error && "message" in error
        ? String(error.message)
        : String(error),
    );
  }
}
