import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  APP_IDS,
  DEFAULT_VISIBLE_APPS,
  getAppLabel,
  isProxyAppId,
  clientCapabilityLabel,
} from "@/config/appConfig";
import { providersApi, settingsApi, type AppId } from "@/lib/api";
import { modelHubApi } from "@/lib/api/model-hub";
import { useWorkspaceReadiness } from "@/lib/query/workspaceReadiness";
import {
  ONBOARDING_KEY,
  readOnboarding,
  saveOnboarding,
  resumeStep,
  clientCommand,
  type OnboardingProgress,
  type OnboardingStep,
} from "@/lib/clientOnboarding";
import { ModelPickerContent } from "@/components/models/ModelPickerDialog";
import { WorkspaceReadiness } from "./WorkspaceReadiness";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ClientOnboarding({
  onClose,
  onConfigure,
  onInstall,
  onVisibilitySaved,
}: {
  onClose: () => void;
  onConfigure: (app: AppId) => void;
  onInstall: () => void;
  onVisibilitySaved: () => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const tr = (cn: string, en: string) => (zh ? cn : en);
  const [loadError] = useState(() => {
    try {
      readOnboarding(localStorage.getItem(ONBOARDING_KEY));
      return false;
    } catch {
      return true;
    }
  });
  const [progress, setProgress] = useState<OnboardingProgress>(() => {
    try {
      return readOnboarding(localStorage.getItem(ONBOARDING_KEY));
    } catch {
      return { version: 1, app: "claude", step: "choose", skipped: false };
    }
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const app = progress.app;
  const readiness = useWorkspaceReadiness(app);
  const catalog = useQuery({
    queryKey: ["model-picker", app],
    queryFn: () =>
      modelHubApi.catalog(app as Parameters<typeof modelHubApi.catalog>[0]),
    enabled: isProxyAppId(app),
  });
  const installation = useQuery({
    queryKey: ["onboarding-installation", app],
    queryFn: async () =>
      app === "claude-desktop"
        ? await invoke<boolean>("onboarding_desktop_installed")
        : (await settingsApi.getToolVersions([clientCommand(app)])).some(
            (v) => !!v.version && !v.installed_but_broken,
          ),
    enabled: progress.step === "install",
    staleTime: 30000,
  });
  function move(step: OnboardingStep, skipped = false, selected = app) {
    const next: OnboardingProgress = {
      version: 1,
      app: selected,
      step,
      skipped,
    };
    try {
      saveOnboarding(next);
      setProgress(next);
      setError("");
      return true;
    } catch {
      setError(
        tr(
          "引导记录无法保存，请检查本地存储。",
          "Cannot save onboarding progress; check local storage.",
        ),
      );
      return false;
    }
  }
  const configured =
    readiness.data?.checks.some(
      (c) => c.id === "configuration" && c.state === "pass",
    ) ?? false;
  const reconciled = useRef(false);
  useEffect(() => {
    if (
      reconciled.current ||
      !readiness.data ||
      readiness.isError ||
      (isProxyAppId(app) && !catalog.data)
    )
      return;
    reconciled.current = true;
    setProgress((old) => ({
      ...old,
      step: resumeStep(old, configured, !!catalog.data?.model),
    }));
  }, [readiness.data, readiness.isError, catalog.data, app, configured]);
  const step = progress.step;
  const labels: Record<OnboardingStep, string> = {
    choose: tr("选择客户端", "Choose client"),
    install: tr("检查安装", "Check installation"),
    configure: tr("添加或导入配置", "Add or import configuration"),
    model: tr("选择模型", "Choose model"),
    verify: tr("验证模型", "Verify model"),
    finish: tr("开始使用", "Start using"),
  };
  const skip = () => {
    if (!busy && move(progress.step, true)) onClose();
  };
  async function openClient() {
    setBusy(true);
    try {
      if (app === "claude-desktop") await invoke("open_onboarding_desktop");
      else {
        const id = catalog.data?.providerId;
        if (!id || id.startsWith("@group:"))
          throw new Error("Select a single provider first");
        await providersApi.openTerminal(id, app);
      }
    } catch {
      setError(
        tr(
          "未能打开客户端，请从终端或应用程序手动启动。",
          "Could not open the client; launch it from Terminal or Applications.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) skip();
      }}
    >
      <DialogContent
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
        zIndex="top"
      >
        <DialogHeader>
          <DialogTitle>
            {tr("客户端接入", "Client setup")} · {labels[step]}
          </DialogTitle>
          <DialogDescription>
            {tr(
              "保存配置与客户端读取、模型验证分别确认。可随时跳过，从概览继续。",
              "Configuration, client reload and model verification are separate. Skip anytime and resume from Overview.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-6">
          {loadError ? (
            <p role="alert">
              {tr(
                "引导记录版本不受支持或已损坏，未覆盖原记录。请使用兼容版本。",
                "Onboarding data is unsupported or damaged. It has not been overwritten; use a compatible version.",
              )}
            </p>
          ) : (
            <>
              <p className="text-sm">
                {getAppLabel(app)} · {clientCapabilityLabel(app, zh)}
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(labels)
                  .filter(
                    ([id]) =>
                      isProxyAppId(app) || !["model", "verify"].includes(id),
                  )
                  .map(([id, label]) => (
                    <Button
                      key={id}
                      size="sm"
                      variant={step === id ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => move(id as OnboardingStep)}
                    >
                      {label}
                    </Button>
                  ))}
              </div>
              {step === "choose" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {APP_IDS.map((id) => (
                      <Button
                        key={id}
                        variant={app === id ? "default" : "outline"}
                        onClick={() => move("choose", false, id)}
                      >
                        {getAppLabel(id)}
                      </Button>
                    ))}
                  </div>
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const settings = await settingsApi.get();
                        await settingsApi.save({
                          ...settings,
                          visibleApps: APP_IDS.reduce(
                            (result, id) => ({ ...result, [id]: id === app }),
                            { ...DEFAULT_VISIBLE_APPS },
                          ),
                        });
                        onVisibilitySaved();
                      } catch {
                        setError(
                          tr("显示偏好保存失败", "Could not save visibility"),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {tr(
                      "仅显示所选客户端（其他工具仍可在安装与管理找到）",
                      "Show only this client (others remain in Install and manage)",
                    )}
                  </Button>
                  <Button onClick={() => move("install")}>
                    {tr("继续", "Continue")}
                  </Button>
                </>
              )}
              {step === "install" && (
                <>
                  <p role="status">
                    {installation.isError
                      ? tr("安装状态未知", "Installation status unknown")
                      : installation.isPending
                        ? tr("正在检查安装…", "Checking installation…")
                        : installation.data
                          ? tr("已检测到安装", "Installation detected")
                          : tr(
                              "未检测到可用安装，可先配置或进入安装与管理。",
                              "No usable installation detected. Configure now or open Install and manage.",
                            )}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (move("install")) onInstall();
                    }}
                  >
                    {tr("安装与管理", "Install and manage")}
                  </Button>
                  <Button onClick={() => move("configure")}>
                    {tr("继续配置", "Continue configuration")}
                  </Button>
                </>
              )}
              {step === "configure" && (
                <>
                  <p>
                    {configured
                      ? tr(
                          "已有配置，继续时不会重复导入。",
                          "Configuration exists; continuing will not import it again.",
                        )
                      : tr(
                          "请使用现有供应商页添加或导入；完成后点击继续接入返回。",
                          "Add or import from the provider page, then return with Resume setup.",
                        )}
                  </p>
                  <Button
                    onClick={() => {
                      if (move("configure")) onConfigure(app);
                    }}
                  >
                    {tr("添加或导入供应商", "Add or import providers")}
                  </Button>
                  <Button
                    disabled={!configured || readiness.isError}
                    onClick={() => move(isProxyAppId(app) ? "model" : "finish")}
                  >
                    {tr("配置已保存，继续", "Configuration saved, continue")}
                  </Button>
                </>
              )}
              {step === "model" && isProxyAppId(app) && (
                <>
                  <ModelPickerContent
                    fixedClient
                    initialApp={app}
                    page
                    setBusy={setBusy}
                  />
                  <Button
                    disabled={busy || !catalog.data?.model}
                    onClick={() => move("verify")}
                  >
                    {tr("继续验证", "Continue to verification")}
                  </Button>
                </>
              )}
              {(step === "verify" || step === "finish") && (
                <>
                  <WorkspaceReadiness
                    fixedApp={app}
                    onManageProviders={onConfigure}
                  />
                  <p>
                    {tr(
                      "外部客户端读取仍未观测；请重新打开客户端或新建会话。",
                      "Client reload is not observed; reopen the client or start a new session.",
                    )}
                  </p>
                  <p>
                    {tr("启动命令：", "Launch command: ")}
                    <code>{clientCommand(app)}</code>
                  </p>
                  <Button
                    disabled={
                      busy ||
                      (app !== "claude-desktop" &&
                        (!catalog.data?.providerId ||
                          catalog.data.providerId.startsWith("@group:")))
                    }
                    variant="outline"
                    onClick={() => void openClient()}
                  >
                    {app === "claude-desktop"
                      ? tr("打开 Claude Desktop", "Open Claude Desktop")
                      : tr("打开供应商终端", "Open provider terminal")}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (move("finish", true)) onClose();
                    }}
                  >
                    {tr("完成配置", "Finish configuration")}
                  </Button>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={loadError ? onClose : skip}
          >
            {tr("稍后继续", "Continue later")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
