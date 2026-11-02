import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useDesktopPreferences } from "@/lib/desktopPreferences";
import {
  checkForUpdate,
  type UpdateInfo,
  type UpdateProgress,
} from "@/lib/updater";
import { settingsApi } from "@/lib/api";
import { extractErrorMessage } from "@/utils/errorUtils";

export type UpdateStage =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "verifying"
  | "ready"
  | "installing"
  | "restarting"
  | "error";
interface UpdateContextValue {
  hasUpdate: boolean;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  error: string | null;
  isDismissed: boolean;
  stage: UpdateStage;
  progress: UpdateProgress | null;
  dismissUpdate: () => void;
  resetDismiss: () => void;
  resetUpdate: () => void;
  checkUpdate: () => Promise<boolean>;
  downloadUpdate: () => Promise<void>;
  cancelUpdate: () => Promise<void>;
  installUpdate: () => void;
}
const UpdateContext = createContext<UpdateContextValue | undefined>(undefined);
const DISMISSED = "sivio:update:dismissedVersion";
function dismissedVersion() {
  const current = localStorage.getItem(DISMISSED);
  if (current) return current;
  const old =
    localStorage.getItem("ccswitch:update:dismissedVersion") ??
    localStorage.getItem("dismissedUpdateVersion");
  if (old) localStorage.setItem(DISMISSED, old);
  return old;
}
export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const desktop = useDesktopPreferences();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [stage, setStage] = useState<UpdateStage>("idle");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const epoch = useRef(0);
  const busy = useRef(false);
  const candidate = useRef<UpdateInfo | null>(null);
  const resetUpdate = useCallback(() => {
    epoch.current++;
    candidate.current = null;
    setUpdateInfo(null);
    setStage("idle");
    setProgress(null);
    setError(null);
    setIsDismissed(false);
  }, []);
  const fail = (error: unknown) => {
    setError(extractErrorMessage(error) || String(error));
    setStage("error");
  };
  const checkUpdate = useCallback(async () => {
    if (busy.current) throw new Error("UPDATE_BUSY: 更新正在进行");
    busy.current = true;
    const revision = ++epoch.current;
    setStage("checking");
    setError(null);
    try {
      const result = await checkForUpdate();
      if (revision !== epoch.current)
        throw new Error("UPDATE_STALE: 更新源已改变，请重新检查");
      const info = result.status === "available" ? result.info : null;
      candidate.current = info;
      setUpdateInfo(info);
      setProgress(null);
      setStage(info ? "available" : "idle");
      setIsDismissed(!!info && dismissedVersion() === info.availableVersion);
      return !!info;
    } catch (error) {
      if (revision === epoch.current) {
        candidate.current = null;
        setUpdateInfo(null);
        fail(error);
      }
      throw error;
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    const cleaners: (() => void)[] = [];
    const add = (fn: () => void) => (disposed ? fn() : cleaners.push(fn));
    void listen<UpdateProgress>("update-download-progress", ({ payload }) => {
      if (payload.candidateId !== candidate.current?.candidateId) return;
      setProgress(payload);
      setStage(payload.stage);
    })
      .then(add)
      .catch(() => {});
    void listen("update-channel-changed", resetUpdate)
      .then(add)
      .catch(() => {});
    return () => {
      disposed = true;
      cleaners.forEach((fn) => fn());
    };
  }, [resetUpdate]);
  const downloadUpdate = async () => {
    const info = candidate.current;
    if (!info || busy.current) return;
    busy.current = true;
    const revision = epoch.current;
    setStage("downloading");
    setError(null);
    setProgress(null);
    try {
      await settingsApi.downloadAppUpdate(info.candidateId);
      if (revision === epoch.current) setStage("ready");
    } catch (error) {
      if (revision === epoch.current) fail(error);
    } finally {
      busy.current = false;
    }
  };
  const cancelUpdate = async () => {
    const info = candidate.current;
    if (!info) return;
    try {
      await settingsApi.cancelAppUpdate(info.candidateId);
      resetUpdate();
    } catch (error) {
      fail(error);
    }
  };
  const installUpdate = () => {
    const info = candidate.current;
    if (!info || stage !== "ready" || busy.current) return;
    const proceed = () => {
      if (candidate.current?.candidateId !== info.candidateId || busy.current)
        return;
      busy.current = true;
      setStage("installing");
      setError(null);
      void settingsApi
        .installUpdateAndRestart(info.candidateId)
        .catch(fail)
        .finally(() => {
          busy.current = false;
        });
    };
    // App owns the shared unsaved-draft and in-flight-operation gate.
    window.dispatchEvent(
      new CustomEvent("sivio-install-update-request", { detail: proceed }),
    );
  };
  const dismissUpdate = () => {
    setIsDismissed(true);
    if (updateInfo)
      localStorage.setItem(DISMISSED, updateInfo.availableVersion);
  };
  const resetDismiss = () => {
    setIsDismissed(false);
    [
      DISMISSED,
      "ccswitch:update:dismissedVersion",
      "dismissedUpdateVersion",
    ].forEach((key) => localStorage.removeItem(key));
  };
  useEffect(() => {
    if (!desktop.data?.preferences.autoCheckUpdate) return;
    const timer = setTimeout(() => {
      void checkUpdate().catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [checkUpdate, desktop.data?.preferences.autoCheckUpdate]);
  return (
    <UpdateContext.Provider
      value={{
        hasUpdate: !!updateInfo,
        updateInfo,
        stage,
        progress,
        error,
        isChecking: stage === "checking",
        isDismissed,
        dismissUpdate,
        resetDismiss,
        resetUpdate,
        checkUpdate,
        downloadUpdate,
        cancelUpdate,
        installUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}
export function useUpdate() {
  const context = useContext(UpdateContext);
  if (!context) throw new Error("useUpdate must be used within UpdateProvider");
  return context;
}
