import { saveOnboarding } from "@/lib/clientOnboarding";
import { CredentialMigrationNotice } from "@/components/settings/CredentialMigrationNotice";
import { NetworkRuntimeProvider } from "@/components/network/NetworkRuntime";
import { DRAG_REGION_ATTR } from "@/lib/platform";
import { WorkspaceFrame } from "@/components/shell/WorkspaceFrame";
import { useNetworkText } from "@/components/network/networkText";
import { DomainRail } from "@/components/shell/DomainRail";
import {
  useDomainNavigation,
  viewForDomain,
} from "@/hooks/useDomainNavigation";
import { useViewScroll } from "@/hooks/useViewMemory";
import type { Domain, NetworkTab } from "@/lib/navigation";
import { useDesktopPreferences } from "@/lib/desktopPreferences";
import { Overview } from "@/components/overview/Overview";
import { NetworkWorkspace } from "@/components/network/NetworkWorkspace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Provider, VisibleApps } from "@/types";
import { KNOWN_APP_TYPES, type AppTypeFilter } from "@/types/usage";
import type { EnvConflict } from "@/types/env";
import {
  providersQueryOptions,
  proxyKeys,
  useProvidersQuery,
  useSettingsQuery,
} from "@/lib/query";
import {
  piApi,
  providersApi,
  settingsApi,
  type AppId,
  type ProviderSwitchEvent,
} from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { hermesKeys, useOpenHermesWebUI } from "@/hooks/useHermes";
import { hermesApi } from "@/lib/api/hermes";
import type { ProviderEditorSave } from "@/lib/api/providers";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useUsageCacheBridge } from "@/hooks/useUsageCacheBridge";
import {
  useTrayAppPageSeen,
  useTrayNavigation,
} from "@/hooks/useTrayNavigation";
import { useTauriEvent } from "@/hooks/useTauriEvent";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import {
  extractErrorMessage,
  translatePiProviderMutationError,
} from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { deepClone } from "@/utils/deepClone";
import { isLinux, isMac, isWindows } from "@/lib/platform";
import {
  APP_STORAGE_KEY,
  appPageBelongsTo,
  isAppPage,
  sharedFeatureAppOf,
  storeView,
  type GlobalPage,
  type SettingsSection,
  type View,
} from "@/lib/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { useUpdate } from "@/contexts/UpdateContext";
import { NewLayoutDialog } from "@/components/shell/NewLayoutDialog";
import {
  AppPageHeader,
  WindowControlsContext,
} from "@/components/shell/AppPageHeader";
import { WindowControls } from "@/components/shell/WindowControls";
import { APP_DISPLAY_NAME, AppGlyph } from "@/components/shell/AppGlyph";
import { ProfileSwitcher } from "@/components/profiles/ProfileSwitcher";
import { ProviderList } from "@/components/providers/ProviderList";
import { AddProviderDialog } from "@/components/providers/AddProviderDialog";
import {
  hasOpencodeDefinition,
  isNativeOpencodeConfig,
} from "@/components/providers/forms/helpers/opencodeFormUtils";
import { EditProviderDialog } from "@/components/providers/EditProviderDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  discardUnsavedChanges,
  hasUnsavedChanges,
  hasPendingMutation,
} from "@/lib/unsavedChanges";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import { AppsPage } from "@/components/apps/AppsPage";
import {
  checkToolUpdatesInBackground,
  useToolUpdatesAvailable,
} from "@/components/apps/useToolManagement";
import { UsagePage } from "@/components/usage/UsagePage";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { RoutingGroupsPage } from "@/components/models/RoutingGroupsPage";
import { ModelConnectionsPage } from "@/components/models/ModelConnectionsPage";
import { ModelHubPage } from "@/components/models/ModelHubPage";
import { SwitchModePanel } from "@/components/providers/mode/SwitchModePanel";
import { DesktopAccessBar } from "@/components/providers/mode/DesktopAccessBar";
import { proxyApi } from "@/lib/api/proxy";
import type { AppMode, StartupAttachFailure } from "@/types/proxy";
import UsageScriptModal from "@/components/UsageScriptModal";
import UnifiedMcpPanel from "@/components/mcp/UnifiedMcpPanel";
import PromptPanel from "@/components/prompts/PromptPanel";
import { PROMPT_APP_IDS } from "@/lib/query/prompts";
import UnifiedSkillsPanel from "@/components/skills/UnifiedSkillsPanel";
import { DeepLinkImportDialog } from "@/components/DeepLinkImportDialog";
import {
  CommandPalette,
  type CommandTarget,
} from "@/components/shell/CommandPalette";
import { ClientOnboarding } from "@/components/overview/ClientOnboarding";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { WhatsNewNotice } from "@/components/WhatsNewDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverTip } from "@/components/ui/hover-tip";
import { HelpTip } from "@/components/ui/help-tip";
import { PageTabs } from "@/components/ui/page-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SessionManagerPage } from "@/components/sessions/SessionManagerPage";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import { invalidatePiProviderCaches, usePiCurrentState } from "@/lib/query/pi";
import WorkspaceFilesPanel from "@/components/workspace/WorkspaceFilesPanel";
import EnvPanel from "@/components/openclaw/EnvPanel";
import ToolsPanel from "@/components/openclaw/ToolsPanel";
import AgentsDefaultsPanel from "@/components/openclaw/AgentsDefaultsPanel";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesMemoryPanel, {
  HermesMemorySaveButton,
} from "@/components/hermes/HermesMemoryPanel";
import {
  APP_IDS,
  DEFAULT_VISIBLE_APPS,
  isProxyAppId,
} from "@/config/appConfig";

interface SyncStatusUpdatedPayload {
  source?: string;
  status?: string;
  error?: string;
}

type OpenClawConfigTab = "env" | "tools" | "agents";

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(APP_STORAGE_KEY) as AppId | null;
  if (saved && APP_IDS.includes(saved)) {
    return saved;
  }
  return "claude";
};

function App() {
  const { t, i18n } = useTranslation();
  const networkText = useNetworkText();
  const queryClient = useQueryClient();
  const { hasUpdate } = useUpdate();

  const [activeApp, setActiveApp] = useState<AppId>(getInitialApp);
  const sharedFeatureApp = sharedFeatureAppOf(activeApp);
  const {
    navigation,
    setView: setCurrentView,
    setNetworkTab,
  } = useDomainNavigation();
  const currentView = navigation.view;
  const networkNavigation = useRef<((tab: NetworkTab) => void) | null>(null);
  const desktopPreferences = useDesktopPreferences();
  const startupPageApplied = useRef(false);
  const navigationTouched = useRef(false);
  useEffect(() => {
    const page = desktopPreferences.data?.preferences.startPage;
    if (!page || startupPageApplied.current) return;
    startupPageApplied.current = true;
    if (!navigationTouched.current && page !== "remember")
      setCurrentView(page as View);
  }, [desktopPreferences.data]);

  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("general");
  const [appConfigScrollTarget, setAppConfigScrollTarget] = useState<AppId>();
  // 进设置前停留的页面：设置目录里的「← 返回」回到这里
  const settingsReturnViewRef = useRef<View>(navigation.returnView);
  const [openclawConfigTab, setOpenclawConfigTab] =
    useState<OpenClawConfigTab>("env");
  const [promptsApp, setPromptsApp] = useState<AppId>(() =>
    PROMPT_APP_IDS.includes(sharedFeatureApp) ? sharedFeatureApp : "claude",
  );
  const [isAddOpen, setIsAddOpen] = useState(false);
  // 供应商搜索面板：页头按钮和 ⌘F 都能打开；换应用或离开供应商页就收起
  const [providerSearchOpen, setProviderSearchOpen] = useState(false);
  useEffect(() => {
    setProviderSearchOpen(false);
  }, [activeApp]);
  // 供应商页顶部正在看的那格（直连 / 路由 / 聚合），由 SwitchModePanel 报上来。打开新增、
  // 编辑时记下当时那格，表单按它选布局：在聚合那格打开就是聚合的简化表单。
  const [providerModeView, setProviderModeView] = useState<{
    app: AppId;
    view: AppMode;
  } | null>(null);
  const [formModeView, setFormModeView] = useState<AppMode>();
  const handleProviderModeViewChange = useCallback(
    (app: AppId, view: AppMode) => setProviderModeView({ app, view }),
    [],
  );
  // 托盘里点了直连下需要路由的那家：打开应用页后弹「需要路由」对话框
  const [trayNeedsRoute, setTrayNeedsRoute] = useState<{
    app: AppId;
    providerId: string;
    nonce: number;
  } | null>(null);
  const [mcpManagementBusy, setMcpManagementBusy] = useState(false);
  const [skillsNavigationBusy, setSkillsNavigationBusy] = useState(false);
  const [promptNavigationBusy, setPromptNavigationBusy] = useState(false);
  const [modelSelectionBusy, setModelSelectionBusy] = useState(false);

  useEffect(() => {
    storeView(currentView);
  }, [currentView]);

  const [commandTarget, setCommandTarget] = useState<CommandTarget | null>(
    null,
  );
  useEffect(() => {
    setCommandTarget((target) => {
      const destination =
        target?.kind === "model"
          ? "modelPicker"
          : target?.kind === "node"
            ? "network"
            : target?.kind === "session"
              ? "sessions"
              : undefined;
      return destination && destination !== currentView ? null : target;
    });
  }, [currentView]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingReturn, setOnboardingReturn] = useState(false);
  const [modelReturn, setModelReturn] = useState(false);
  const { data: settingsData } = useSettingsQuery();
  useEffect(() => {
    if (!settingsData || !desktopPreferences.data) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void emit("desktop-ui-ready").catch(() => {});
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [settingsData, desktopPreferences.data]);
  // Windows 一律去掉系统标题栏，用页头里的应用内窗口按钮；Linux 由设置决定
  const useAppWindowControls =
    isWindows() || (isLinux() && (settingsData?.useAppWindowControls ?? false));
  const visibleApps = useMemo<VisibleApps>(
    () => ({
      ...DEFAULT_VISIBLE_APPS,
      ...settingsData?.visibleApps,
    }),
    [settingsData?.visibleApps],
  );

  const getFirstVisibleApp = (): AppId => {
    return APP_IDS.find((app) => visibleApps[app]) ?? "claude";
  };

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps]);

  // 启动后把其他可见应用的供应商列表预取进缓存：第一次切过去直接有数据，不先画骨架
  const providersPrefetchedRef = useRef(false);
  useEffect(() => {
    if (!settingsData || providersPrefetchedRef.current) return;
    providersPrefetchedRef.current = true;
    for (const app of APP_IDS) {
      if (app !== activeApp && visibleApps[app]) {
        void queryClient.prefetchQuery(providersQueryOptions(app));
      }
    }
  }, [settingsData, visibleApps, activeApp, queryClient]);

  // 「启动时检查应用更新」（默认关）：打开了才在后台查一次，查到新版本侧栏「应用」上出现圆点
  const checkToolUpdatesOnStartup =
    settingsData?.checkToolUpdatesOnStartup ?? false;
  const toolUpdatesAvailable = useToolUpdatesAvailable();
  const startupToolCheckDoneRef = useRef(false);
  useEffect(() => {
    if (!checkToolUpdatesOnStartup || startupToolCheckDoneRef.current) return;
    startupToolCheckDoneRef.current = true;
    void checkToolUpdatesInBackground();
  }, [checkToolUpdatesOnStartup]);

  // 启动时没能接上路由 / 聚合、已退回直连的应用：在对应的应用页提示一次并给「重试」
  const [startupFailures, setStartupFailures] = useState<
    StartupAttachFailure[]
  >([]);
  useEffect(() => {
    proxyApi
      .takeStartupAttachFailures()
      .then((failures) => {
        if (failures?.length) setStartupFailures(failures);
      })
      .catch(() => undefined);
  }, []);

  // 应用专属页（工作区、记忆…）只属于它的应用；换了应用就回到供应商页
  useEffect(() => {
    if (isAppPage(currentView) && !appPageBelongsTo(currentView, activeApp)) {
      setCurrentView("providers");
    }
  }, [activeApp, currentView]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<EnvConflict[]>([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);
  const mainScrollRef = useRef<HTMLElement>(null);
  const providerScrollContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (
      navigationTouched.current &&
      !document.querySelector('[role="dialog"], dialog[open]')
    )
      mainScrollRef.current?.focus({ preventScroll: true });
  }, [currentView, activeApp, navigation.networkTab, settingsSection]);

  useUsageCacheBridge();

  useViewScroll(mainScrollRef, `main:${currentView}:${activeApp}`);
  useViewScroll(
    providerScrollContainerRef,
    `providers:${activeApp}`,
    currentView === "providers",
  );

  const { isRunning: isProxyRunning, takeoverStatus } = useProxyStatus();
  const proxyAppId = isProxyAppId(activeApp) ? activeApp : null;
  // 换了应用、新面板还没报上来时为 undefined：表单按应用实际生效的模式
  const currentModeView =
    providerModeView?.app === activeApp ? providerModeView.view : undefined;
  const openAddProvider = (modeView: AppMode | undefined) => {
    setFormModeView(modeView);
    setIsAddOpen(true);
  };
  const currentAppUsesProxy =
    proxyAppId !== null || activeApp === "claude-desktop";
  const isCurrentAppTakeoverActive = proxyAppId
    ? takeoverStatus?.[proxyAppId] || false
    : false;

  const { data, isLoading, refetch } = useProvidersQuery(activeApp, {
    isProxyRunning: currentAppUsesProxy && isProxyRunning,
  });
  const { data: piCurrentState } = usePiCurrentState(activeApp === "pi");
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const isOpenClawView = activeApp === "openclaw" && isAppPage(currentView);
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);
  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning && isCurrentAppTakeoverActive,
  );
  const handleEnablePiProvider = async (provider: Provider) => {
    try {
      await providersApi.switch(provider.id, "pi");
      await invalidatePiProviderCaches(queryClient);
      await providersApi.updateTrayMenu().catch((error) => {
        console.error(
          "Failed to update tray menu after enabling Pi provider",
          error,
        );
      });
      toast.success(
        t("pi.provider.enabled", {
          defaultValue: "已在 Pi 中启用",
        }),
        { closeButton: true },
      );
    } catch (error) {
      const detail = extractErrorMessage(error);
      toast.error(
        t("pi.provider.enableFailed", {
          defaultValue: "无法在 Pi 中启用此供应商",
        }),
        {
          description:
            translatePiProviderMutationError(detail, t) || detail || undefined,
          closeButton: true,
        },
      );
    }
  };

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    const setupListener = async () => {
      try {
        const off = await providersApi.onSwitched(
          async (event: ProviderSwitchEvent) => {
            if (event.appType === activeApp) {
              await refetch();
            }
            if (event.appType === "pi") {
              await invalidatePiProviderCaches(queryClient);
            }
          },
        );
        if (!active) {
          off();
          return;
        }
        unsubscribe = off;
      } catch (error) {
        console.error("[App] Failed to subscribe provider switch event", error);
      }
    };

    void setupListener();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [activeApp, queryClient, refetch]);

  useTauriEvent("universal-provider-synced", async () => {
    await queryClient.invalidateQueries({ queryKey: ["providers"] });
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to update tray menu", error);
    }
  });

  // 应用项目后刷新相关缓存（providers 由既有 provider-switched 监听承接；
  // proxy 状态由后端直接改 DB，不走 mutation，必须显式刷新）
  useTauriEvent("profile-applied", async () => {
    await queryClient.invalidateQueries({ queryKey: ["profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["mcp", "all"] });
    await queryClient.invalidateQueries({ queryKey: ["skills"] });
    await queryClient.invalidateQueries({
      queryKey: proxyKeys.takeoverStatus,
    });
    await queryClient.invalidateQueries({ queryKey: proxyKeys.status });
    await queryClient.invalidateQueries({
      queryKey: ["providers", "claude-desktop"],
    });
  });

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "webdav-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.webdavSync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<SyncStatusUpdatedPayload | null | undefined>(
    "s3-sync-status-updated",
    async (payload) => {
      const statusPayload = payload ?? {};
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      if (statusPayload.source !== "auto" || statusPayload.status !== "error") {
        return;
      }
      toast.error(
        t("settings.s3Sync.autoSyncFailedToast", {
          error: statusPayload.error || t("common.unknown"),
        }),
      );
    },
  );

  useTauriEvent<{ appType: string; providerName: string }>(
    "proxy-official-warning",
    (payload) => {
      toast.warning(
        t("notifications.proxyOfficialWarning", {
          name: payload.providerName,
          defaultValue: `当前供应商 ${payload.providerName} 是官方供应商，建议切换到第三方供应商后再使用代理接管`,
        }),
        { duration: 8000 },
      );
    },
  );

  useEffect(() => {
    // settingsData 未加载时跳过，避免用 fallback false 覆盖 Rust 侧已设好的装饰状态
    if (!settingsData) return;

    const syncWindowDecorations = async () => {
      try {
        await getCurrentWindow().setDecorations(!useAppWindowControls);
      } catch (error) {
        console.error("[App] Failed to update window decorations", error);
      }
    };

    void syncWindowDecorations();
  }, [useAppWindowControls, settingsData]);

  useEffect(() => {
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    checkEnvOnStartup();
  }, []);

  useEffect(() => {
    const checkMigration = async () => {
      try {
        const migrated = await invoke<boolean>("get_migration_result");
        if (migrated) {
          toast.success(
            t("migration.success", { defaultValue: "配置迁移成功" }),
            { closeButton: true },
          );
        }
      } catch (error) {
        console.error("[App] Failed to check migration result:", error);
      }
    };

    checkMigration();
  }, [t]);

  useEffect(() => {
    const checkSkillsMigration = async () => {
      try {
        const result = await invoke<{ count: number; error?: string } | null>(
          "get_skills_migration_result",
        );
        if (result?.error) {
          toast.error(t("migration.skillsFailed"), {
            description: t("migration.skillsFailedDescription"),
            closeButton: true,
          });
          console.error("[App] Skills SSOT migration failed:", result.error);
          return;
        }
        if (result && result.count > 0) {
          toast.success(t("migration.skillsSuccess", { count: result.count }), {
            closeButton: true,
          });
          await queryClient.invalidateQueries({ queryKey: ["skills"] });
        }
      } catch (error) {
        console.error("[App] Failed to check skills migration result:", error);
      }
    };

    checkSkillsMigration();
  }, [t, queryClient]);

  useEffect(() => {
    const checkEnvOnSwitch = async () => {
      try {
        if (activeApp === "mcode") return;
        const conflicts = await checkEnvConflicts(activeApp);

        if (conflicts.length > 0) {
          setEnvConflicts((prev) => {
            const existingKeys = new Set(
              prev.map((c) => `${c.varName}:${c.sourcePath}`),
            );
            const newConflicts = conflicts.filter(
              (c) => !existingKeys.has(`${c.varName}:${c.sourcePath}`),
            );
            return [...prev, ...newConflicts];
          });
          const dismissed = sessionStorage.getItem("env_banner_dismissed");
          if (!dismissed) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    checkEnvOnSwitch();
  }, [activeApp]);

  const currentViewRef = useRef(currentView);
  const managementBusy =
    mcpManagementBusy ||
    skillsNavigationBusy ||
    promptNavigationBusy ||
    modelSelectionBusy;
  const managementBusyRef = useRef(false);
  managementBusyRef.current = managementBusy;
  const navigationBusy = () =>
    managementBusyRef.current || hasPendingMutation();

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  // ─── 导航 ───────────────────────────────────────────────────────────────
  // MCP / Skills / 提示词在进行中的操作会锁住导航（卸载面板会丢掉进行中的状态）

  // 添加 / 编辑 / 用量脚本面板只盖住内容区，侧栏还能点。离开当前页就把它们关掉：
  // 面板的 appId 跟着 activeApp 走，开着切应用会把 A 应用的供应商保存进 B 应用
  const closeProviderPanels = () => {
    setIsAddOpen(false);
    setEditingProvider(null);
    setUsageProvider(null);
  };

  // 整页编辑器里有未保存的修改：先确认，确认放弃后再执行这次导航
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const confirmLeave = (proceed: () => void) => {
    if (!hasUnsavedChanges()) return false;
    setPendingLeave(() => proceed);
    return true;
  };

  useTauriEvent<{ automatic?: boolean } | null>(
    "lightweight-requested",
    (request) => {
      const automatic = request?.automatic === true;
      if (automatic && (navigationBusy() || hasUnsavedChanges())) return;
      if (navigationBusy()) {
        toast.info(
          t("lightweight.busy", {
            defaultValue: "操作进行中，完成后可进入轻量模式",
          }),
        );
        return;
      }
      const enter = () => {
        void (
          automatic
            ? invoke("enter_lightweight_mode", { automatic: true })
            : invoke("enter_lightweight_mode")
        ).catch((error) => toast.error(String(error)));
      };
      if (!confirmLeave(enter)) enter();
    },
  );

  useTauriEvent("desktop-quit-requested", () => {
    if (navigationBusy()) {
      toast.info(
        t("desktop.quitBusy", { defaultValue: "操作进行中，完成后可退出" }),
      );
      return;
    }
    const quit = () => {
      void invoke("desktop_quit").catch((error) => toast.error(String(error)));
    };
    if (!confirmLeave(quit)) quit();
  });
  useTauriEvent<{ action: string; error?: string | null }>(
    "desktop-action-result",
    (result) => {
      if (result.error) toast.error(result.error);
      else
        toast.success(
          t("desktop.actionDone", { defaultValue: "网络快捷操作已完成" }),
        );
      void queryClient.invalidateQueries({ queryKey: ["network"] });
    },
  );

  const openSettings = (
    section: SettingsSection = "general",
    appConfigTarget?: AppId,
  ) => {
    if (navigationBusy()) return;
    navigationTouched.current = true;
    if (confirmLeave(() => openSettings(section, appConfigTarget))) return;
    closeProviderPanels();
    if (currentViewRef.current !== "settings") {
      settingsReturnViewRef.current = currentViewRef.current;
    }
    setSettingsSection(section);
    setAppConfigScrollTarget(appConfigTarget);
    setCurrentView("settings");
  };

  const exitSettings = () => {
    if (navigationBusy()) return;
    if (confirmLeave(exitSettings)) return;
    setCurrentView(settingsReturnViewRef.current);
  };

  const selectApp = (app: AppId) => {
    if (navigationBusy()) return;
    navigationTouched.current = true;
    if (confirmLeave(() => selectApp(app))) return;
    closeProviderPanels();
    setActiveApp(app);
    localStorage.setItem(APP_STORAGE_KEY, app);
    setCurrentView("providers");
  };

  const openPage = (page: GlobalPage | "settings") => {
    if (page === "settings") {
      openSettings("general");
      return;
    }
    if (navigationBusy()) return;
    navigationTouched.current = true;
    // 再点当前页不会离开：不弹确认，也不能清掉编辑页的未保存登记
    if (currentViewRef.current === page) return;
    if (confirmLeave(() => openPage(page))) return;
    closeProviderPanels();
    if (page === "prompts" && currentViewRef.current !== "prompts") {
      // 提示词页默认选中侧栏里最后选的那个应用
      setPromptsApp(
        PROMPT_APP_IDS.includes(sharedFeatureApp) ? sharedFeatureApp : "claude",
      );
    }
    setCurrentView(page);
  };
  const openDomain = (domain: Domain) => {
    if (navigationBusy()) return;
    const target = viewForDomain(navigation, domain);
    if (currentView === target) return;
    navigationTouched.current = true;
    if (confirmLeave(() => openDomain(domain))) return;
    closeProviderPanels();
    setCurrentView(target);
  };
  const navigateAppPage = (view: View) => {
    if (navigationBusy() || currentView === view) return;
    if (confirmLeave(() => navigateAppPage(view))) return;
    closeProviderPanels();
    setCurrentView(view);
  };
  const requestNetworkLeave = (proceed: () => void) => {
    if (navigationBusy()) return;
    if (!confirmLeave(proceed)) proceed();
  };
  useTrayAppPageSeen(currentView === "providers" ? activeApp : null);

  useTrayNavigation((navigation) => {
    const navigate = () => {
      if (navigation.page) {
        openPage(navigation.page);
        return;
      }
      if (navigation.section) {
        openSettings(navigation.section);
        return;
      }
      if (!navigation.app) return;
      selectApp(navigation.app);
      // 托盘先换应用：新应用那格还没报上来，按它实际生效的模式
      if (navigation.intent === "add") openAddProvider(undefined);
      if (navigation.intent === "needsRoute" && navigation.providerId) {
        setTrayNeedsRoute({
          app: navigation.app,
          providerId: navigation.providerId,
          nonce: Date.now(),
        });
      }
    };
    if (navigationBusy()) return;
    if (!confirmLeave(navigate)) navigate();
  });

  // 侧栏、⌘K 进用量统计看全部应用；只有应用页 ⋯ 进来时带应用筛选
  const openPageFromNav = (page: GlobalPage | "settings") => {
    // 「设置」上的绿点说的是 Sivio 有新版本，点进去直接到「关于」里的更新按钮
    if (page === "settings" && hasUpdate) {
      openSettings("about");
      return;
    }
    if (page === "usage") setUsageAppFilter("all");
    openPage(page);
  };

  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  const [usageAppFilter, setUsageAppFilter] = useState<AppTypeFilter>("all");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === ",") {
        event.preventDefault();
        openSettingsRef.current("general");
        return;
      }

      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.body.style.overflow === "hidden") return;
      if (navigationBusy()) return;
      if (isTextEditableTarget(event.target)) return;

      const view = currentViewRef.current;
      if (view === "skillsDiscovery") {
        event.preventDefault();
        setCurrentView("skills");
      } else if (view === "settings") {
        event.preventDefault();
        if (!confirmLeave(() => setCurrentView(settingsReturnViewRef.current)))
          setCurrentView(settingsReturnViewRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
    editorSave,
  }: {
    provider: Provider;
    originalId?: string;
    editorSave?: ProviderEditorSave;
  }) => {
    await updateProvider(provider, originalId, editorSave);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      try {
        await providersApi.removeFromLiveConfig(provider.id, activeApp);
      } catch (error) {
        const detail = extractErrorMessage(error);
        const description =
          activeApp === "pi"
            ? translatePiProviderMutationError(detail, t) || detail
            : detail;
        if (activeApp === "pi") {
          void invalidatePiProviderCaches(queryClient).catch(() => undefined);
        }
        toast.error(t("notifications.removeFromConfigFailed"), {
          description: description || t("common.unknown"),
          closeButton: true,
        });
        return;
      }
      if (activeApp === "pi") {
        await invalidatePiProviderCaches(queryClient);
      }
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
      } else if (activeApp === "hermes") {
        await queryClient.invalidateQueries({
          queryKey: hermesKeys.liveProviderIds,
        });
      } else if (activeApp === "mcode") {
        await queryClient.invalidateQueries({
          queryKey: ["providers", "mcode"],
        });
      }
      toast.success(
        activeApp === "pi"
          ? t("pi.provider.removed", {
              defaultValue: "已从 Pi 移除",
            })
          : t("notifications.removeFromConfigSuccess", {
              defaultValue: "已从配置移除",
            }),
        { closeButton: true },
      );
    } else {
      try {
        await deleteProvider(provider.id);
      } catch {
        // useDeleteProviderMutation 的 onError 已经弹了错误 toast；确认框照样关掉
      }
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    if (
      activeApp === "opencode" &&
      provider.category !== "omo" &&
      provider.category !== "omo-slim"
    ) {
      // A copy gets a new ID, so it cannot inherit a built-in definition.
      // Native V2 declarations name their package in `package`, not `npm`.
      const isNative = isNativeOpencodeConfig(
        JSON.stringify(provider.settingsConfig),
        provider.meta?.opencodeConfigFormat,
      );
      if (
        !hasOpencodeDefinition(
          provider.settingsConfig,
          isNative ? "package" : "npm",
        )
      ) {
        toast.error(
          t(
            isNative
              ? "opencode.duplicateRequiresNativeDefinition"
              : "opencode.duplicateRequiresDefinition",
          ),
        );
        return;
      }
    }

    const newSortIndex =
      provider.sortIndex !== undefined ? provider.sortIndex + 1 : undefined;

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: deepClone(provider.settingsConfig),
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      sortIndex: newSortIndex, // 复制原 sortIndex + 1
      meta: provider.meta ? deepClone(provider.meta) : undefined,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes" ||
      activeApp === "pi"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: ["opencodeLiveProviderIds"],
                queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds,
                  queryFn: () => providersApi.getOpenClawLiveProviderIds(),
                })
              : activeApp === "hermes"
                ? await queryClient.ensureQueryData({
                    queryKey: hermesKeys.liveProviderIds,
                    queryFn: () => providersApi.getHermesLiveProviderIds(),
                  })
                : (
                    await queryClient.ensureQueryData({
                      queryKey: ["pi", "currentState"],
                      queryFn: () => piApi.getCurrentState(),
                    })
                  ).enabledProviderIds;
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("provider.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }
      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = false;
    } else if (activeApp === "mcode") {
      // The MCode list already includes its live custom nodes; the backend
      // rejects a key that MCode itself owns.
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        Object.keys(providers),
      );
    }

    if (provider.sortIndex !== undefined) {
      const updates = Object.values(providers)
        .filter(
          (p) =>
            p.sortIndex !== undefined &&
            p.sortIndex >= newSortIndex! &&
            p.id !== provider.id,
        )
        .map((p) => ({
          id: p.id,
          sortIndex: p.sortIndex! + 1,
        }));

      if (updates.length > 0) {
        try {
          await providersApi.updateSortOrder(updates, activeApp);
        } catch (error) {
          console.error("[App] Failed to update sort order", error);
          toast.error(
            t("provider.sortUpdateFailed", {
              defaultValue: "排序更新失败",
            }),
          );
          return; // 如果排序更新失败，不继续添加
        }
      }
    }

    await addProvider(duplicatedProvider);
  };

  const confirmActionMessage = useMemo(() => {
    if (!confirmAction) return "";

    const message =
      confirmAction.action === "remove"
        ? t("confirm.removeProviderMessage", {
            name: confirmAction.provider.name,
          })
        : t("confirm.deleteProviderMessage", {
            name: confirmAction.provider.name,
          });
    const isPiGlobalDefault =
      activeApp === "pi" &&
      piCurrentState?.defaultProviderId === confirmAction.provider.id;

    return isPiGlobalDefault
      ? `${message}\n\n${t("confirm.piDefaultProviderWarning")}`
      : message;
  }, [activeApp, confirmAction, piCurrentState?.defaultProviderId, t]);

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      const selectedDir = await settingsApi.pickDirectory();
      if (!selectedDir) {
        return;
      }

      await providersApi.openTerminal(provider.id, activeApp, {
        cwd: selectedDir,
      });
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const handleImportSuccess = async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: ["providers"],
        refetchType: "all",
      });
      await queryClient.refetchQueries({
        queryKey: ["providers"],
        type: "all",
      });
    } catch (error) {
      console.error("[App] Failed to refresh providers after import", error);
      await refetch();
    }
    try {
      await providersApi.updateTrayMenu();
    } catch (error) {
      console.error("[App] Failed to refresh tray menu", error);
    }
  };

  const handleHideActiveApp = async () => {
    const visibleCount = Object.values(visibleApps).filter(Boolean).length;
    if (visibleCount <= 1) return;
    try {
      const current = await settingsApi.get();
      await settingsApi.save({
        ...current,
        visibleApps: { ...visibleApps, [activeApp]: false },
      });
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (error) {
      toast.error(
        t("settings.saveFailedGeneric", { defaultValue: "保存失败，请重试" }),
        { description: extractErrorMessage(error) || undefined },
      );
    }
  };

  // ─── 应用页 ─────────────────────────────────────────────────────────────

  // 应用页 ⋯ →「查看此应用的用量」：带上这个应用的筛选（Claude Desktop 的流量并在 Claude 里）
  const usageAppOf = (app: AppId): AppTypeFilter | null => {
    const type = app === "claude-desktop" ? "claude" : app;
    return (KNOWN_APP_TYPES as ReadonlyArray<string>).includes(type)
      ? (type as AppTypeFilter)
      : null;
  };
  const activeUsageApp = usageAppOf(activeApp);

  const appMenu = (
    <DropdownMenu>
      <HoverTip content={t("common.more")}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="quiet"
            size="icon-compact"
            className="h-8 w-8"
            aria-label={t("appPage.moreActions", {
              name: APP_DISPLAY_NAME[activeApp],
            })}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </HoverTip>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem onSelect={() => openPage("sessions")}>
          {t("appPage.viewSessions")}
        </DropdownMenuItem>
        {activeUsageApp && (
          <DropdownMenuItem
            onSelect={() => {
              setUsageAppFilter(activeUsageApp);
              openPage("usage");
            }}
          >
            {t("appPage.viewUsage")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openSettings("appConfig", activeApp)}>
          {t("appPage.configDirectory")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openPage("apps")}>
          {t("appPage.installAndUpgrade")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={Object.values(visibleApps).filter(Boolean).length <= 1}
          onSelect={() => void handleHideActiveApp()}
        >
          {t("appPage.hideFromSidebar")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const appPageName =
    currentView === "workspace"
      ? t("appPage.workspace")
      : currentView === "openclawConfig"
        ? t("appPage.openclawConfig")
        : currentView === "hermesMemory"
          ? t("appPage.memory")
          : t("appPage.providers");

  const renderAppPageHeader = () => (
    <AppPageHeader
      variant="app"
      icon={<AppGlyph app={activeApp} size={20} badgeClassName="bg-app" />}
      title={APP_DISPLAY_NAME[activeApp]}
      subtitle={
        activeApp === "openclaw" || activeApp === "hermes"
          ? undefined
          : appPageName
      }
      actions={
        <>
          {currentView === "providers" &&
            activeApp !== "mcode" &&
            (settingsData?.showProfileSwitcher ?? false) && (
              <ProfileSwitcher activeApp={activeApp} />
            )}
          {activeApp === "hermes" && (
            <Button
              variant="quiet"
              size="regular"
              onClick={() => void openHermesWebUI()}
            >
              {t("appPage.webUi")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
          {currentView === "providers" &&
            (settingsData?.showProviderSearch ?? true) && (
              <HoverTip
                content={t("provider.searchButtonTip", {
                  shortcut: isMac() ? "⌘F" : "Ctrl+F",
                })}
              >
                <Button
                  variant="quiet"
                  size="icon-compact"
                  className="h-8 w-8"
                  aria-label={t("provider.searchAriaLabel")}
                  aria-pressed={providerSearchOpen}
                  onClick={() => setProviderSearchOpen((open) => !open)}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </HoverTip>
            )}
          {currentView === "providers" && (
            <Button
              variant="solid"
              size="regular"
              onClick={() => openAddProvider(currentModeView)}
            >
              <Plus className="h-4 w-4" />
              {t("provider.addProvider")}
            </Button>
          )}
          {currentView === "hermesMemory" && <HermesMemorySaveButton />}
          {appMenu}
        </>
      }
    />
  );

  // OpenClaw / Hermes 没有模式 tab，那一行放它们自己的页面导航。
  // 换整块内容的是页面导航，用下划线页签；分段控件只留给模式和页内筛选。
  const renderAppSegments = () => {
    if (activeApp === "openclaw") {
      return (
        <div className="shrink-0 px-6 pt-2">
          <PageTabs
            aria-label={APP_DISPLAY_NAME.openclaw}
            idPrefix="openclaw-page"
            value={currentView}
            onValueChange={(view) => navigateAppPage(view)}
            items={[
              { value: "providers", label: t("appPage.providers") },
              { value: "workspace", label: t("appPage.workspace") },
              { value: "openclawConfig", label: t("appPage.openclawConfig") },
            ]}
          />
        </div>
      );
    }
    if (activeApp === "hermes") {
      return (
        <div className="shrink-0 px-6 pt-2">
          <PageTabs
            aria-label={APP_DISPLAY_NAME.hermes}
            idPrefix="hermes-page"
            value={currentView}
            onValueChange={(view) => navigateAppPage(view)}
            items={[
              { value: "providers", label: t("appPage.providers") },
              { value: "hermesMemory", label: t("appPage.memory") },
            ]}
          />
        </div>
      );
    }
    return null;
  };

  const listCallbacks = {
    onEdit: (provider: Provider) => {
      setFormModeView(currentModeView);
      setEditingProvider(provider);
    },
    onDelete: (provider: Provider) =>
      setConfirmAction({ provider, action: "delete" }),
    onDuplicate: handleDuplicateProvider,
    onConfigureUsage: setUsageProvider,
    onOpenWebsite: handleOpenWebsite,
    onOpenTerminal: activeApp === "claude" ? handleOpenTerminal : undefined,
    onCreate: () => openAddProvider(currentModeView),
    searchOpen: providerSearchOpen,
    onSearchOpenChange: setProviderSearchOpen,
  };

  const renderProviderList = () => {
    if (proxyAppId) {
      const startupFailure = startupFailures.find(
        (failure) => failure.appType === proxyAppId,
      );
      return (
        <SwitchModePanel
          key={proxyAppId}
          app={proxyAppId}
          providers={providers}
          currentProviderId={currentProviderId}
          isLoading={isLoading}
          scrollRef={providerScrollContainerRef}
          onSwitch={switchProvider}
          onOpenRoutingSettings={() => openSettings("routing")}
          needsRouteRequest={
            trayNeedsRoute?.app === proxyAppId ? trayNeedsRoute : undefined
          }
          onNeedsRouteHandled={() => setTrayNeedsRoute(null)}
          onViewChange={handleProviderModeViewChange}
          startupFailure={startupFailure}
          onDismissStartupFailure={() =>
            setStartupFailures((list) =>
              list.filter((failure) => failure.appType !== proxyAppId),
            )
          }
          {...listCallbacks}
        />
      );
    }

    return (
      <div
        ref={providerScrollContainerRef}
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto scroll-stable overflow-x-hidden px-6 pb-12 pt-4"
      >
        <div className="space-y-4">
          {activeApp === "claude-desktop" && (
            <DesktopAccessBar
              current={providers[currentProviderId]}
              onOpenRoutingSettings={() => openSettings("routing")}
            />
          )}
          <ProviderList
            {...listCallbacks}
            providers={providers}
            currentProviderId={currentProviderId}
            appId={activeApp}
            isLoading={isLoading}
            onSwitch={(provider) =>
              void (activeApp === "pi"
                ? handleEnablePiProvider(provider)
                : switchProvider(provider))
            }
            onRemoveFromConfig={
              activeApp === "opencode" ||
              activeApp === "openclaw" ||
              activeApp === "hermes" ||
              activeApp === "pi" ||
              activeApp === "mcode"
                ? (provider) => setConfirmAction({ provider, action: "remove" })
                : undefined
            }
            onDisableOmo={
              activeApp === "opencode" ? handleDisableOmo : undefined
            }
            onDisableOmoSlim={
              activeApp === "opencode" ? handleDisableOmoSlim : undefined
            }
            onSetAsDefault={
              activeApp === "openclaw"
                ? (provider, modelId) =>
                    void setAsDefaultModel(provider, modelId)
                : activeApp === "hermes"
                  ? (provider) => void switchProvider(provider)
                  : undefined
            }
          />
        </div>
      </div>
    );
  };

  const renderAppPage = () => {
    const body = (() => {
      switch (currentView) {
        case "workspace":
          return <WorkspaceFilesPanel />;
        case "openclawConfig":
          return (
            <>
              {/* 二级页签：小一号、不画整行底线，挂在一级页签下面 */}
              <div className="shrink-0 px-6 pt-1">
                <PageTabs
                  size="sm"
                  aria-label={t("appPage.openclawConfig")}
                  idPrefix="openclaw-config"
                  controls="main-content"
                  value={openclawConfigTab}
                  onValueChange={setOpenclawConfigTab}
                  items={[
                    { value: "env", label: t("openclaw.env.title") },
                    { value: "tools", label: t("openclaw.tools.title") },
                    { value: "agents", label: t("openclaw.agents.title") },
                  ]}
                />
              </div>
              <div
                id="main-content"
                role="tabpanel"
                aria-labelledby={`openclaw-config-${openclawConfigTab}`}
                className="min-h-0 flex-1 overflow-y-auto scroll-stable"
              >
                {openclawConfigTab === "env" ? (
                  <EnvPanel />
                ) : openclawConfigTab === "tools" ? (
                  <ToolsPanel />
                ) : (
                  <AgentsDefaultsPanel />
                )}
              </div>
            </>
          );
        case "hermesMemory":
          return (
            <div
              id="main-content"
              className="min-h-0 flex-1 overflow-y-auto scroll-stable"
            >
              <HermesMemoryPanel onOpenWebUI={openHermesWebUI} />
            </div>
          );
        default:
          return renderProviderList();
      }
    })();

    return (
      <>
        {renderAppPageHeader()}
        {renderAppSegments()}
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {body}
      </>
    );
  };

  // ─── 全局页 ─────────────────────────────────────────────────────────────

  const renderGlobalPage = () => {
    switch (currentView) {
      case "overview":
        return (
          <Overview
            onOpen={openPage}
            onApp={selectApp}
            visibleApps={visibleApps}
            onSetup={() => requestNetworkLeave(() => setOnboardingOpen(true))}
          />
        );
      case "network":
        return (
          <NetworkWorkspace
            onManageProviders={selectApp}
            commandSearch={
              commandTarget?.kind === "node" ? commandTarget.name : undefined
            }
            selectedTab={navigation.networkTab}
            onTabChange={setNetworkTab}
            navigationRef={networkNavigation}
            requestLeave={requestNetworkLeave}
          />
        );
      case "routingGroups":
        return <RoutingGroupsPage onBusyChange={setModelSelectionBusy} />;
      case "modelConnections":
        return (
          <ModelConnectionsPage
            onOpen={openPage}
            onApp={selectApp}
            onRouting={() => openSettings("routing")}
          />
        );
      case "modelPicker":
      case "routeDecisions":
        return (
          <ModelHubPage
            view={currentView}
            commandSelection={
              commandTarget?.kind === "model" ? commandTarget : undefined
            }
            onVerify={(app) =>
              requestNetworkLeave(() => {
                try {
                  saveOnboarding({
                    version: 1,
                    app,
                    step: "verify",
                    skipped: false,
                  });
                  setOnboardingOpen(true);
                } catch {
                  toast.error(
                    i18n.language.startsWith("zh")
                      ? "无法保存接入进度"
                      : "Cannot save setup progress",
                  );
                }
              })
            }
            onManageProviders={(app) =>
              requestNetworkLeave(() => {
                setModelReturn(true);
                selectApp(app);
              })
            }
            activeApp={activeApp}
            onBusyChange={setModelSelectionBusy}
          />
        );
      case "usage":
        return (
          <UsagePage
            initialAppType={usageAppFilter}
            onOpenRoutingSettings={() => openSettings("routing")}
          />
        );
      case "auth":
        return (
          <>
            <AppPageHeader
              icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />}
              title={t("nav.auth")}
              titleExtra={
                <>
                  <HelpTip title={t("authCenter.helpTitle")}>
                    {t("settings.authCenter.description")}
                  </HelpTip>
                  <Badge
                    variant="outline"
                    className="ms-1 h-5 px-1.5 text-badge font-medium"
                  >
                    {t("settings.authCenter.beta", { defaultValue: "Beta" })}
                  </Badge>
                </>
              }
            />
            <div
              id="main-content"
              className="min-h-0 flex-1 overflow-y-auto scroll-stable"
            >
              <div className="px-6 pb-10 pt-4">
                <AuthCenterPanel showIntro={false} />
              </div>
            </div>
          </>
        );
      case "mcp":
        return (
          <UnifiedMcpPanel onInteractionBlockedChange={setMcpManagementBusy} />
        );
      case "skills":
      case "skillsDiscovery":
        // 「已安装 / 发现」合成一页；旧的 skillsDiscovery 视图直接打开「发现」段
        return (
          <UnifiedSkillsPanel
            initialView={
              currentView === "skillsDiscovery" ? "discover" : "installed"
            }
            onNavigationBlockedChange={setSkillsNavigationBusy}
          />
        );
      case "prompts":
        return (
          <div id="main-content" className="flex min-h-0 flex-1 flex-col">
            <PromptPanel
              appId={promptsApp}
              apps={PROMPT_APP_IDS.filter(
                (app) =>
                  visibleApps[app] ||
                  (app === "claude" && visibleApps["claude-desktop"]) ||
                  app === promptsApp,
              )}
              onAppChange={setPromptsApp}
              onNavigationBlockedChange={setPromptNavigationBusy}
            />
          </div>
        );
      case "sessions":
        // 页头（含 ⋯ 菜单）由会话页自己画：菜单里的操作都在页面状态里
        return (
          <SessionManagerPage
            key={sharedFeatureApp}
            commandSession={
              commandTarget?.kind === "session" ? commandTarget : undefined
            }
            appId={sharedFeatureApp}
            fromApp={activeApp}
            onOpenTerminalSettings={() => openSettings("general")}
          />
        );
      case "apps":
        return <AppsPage />;
      default:
        return null;
    }
  };

  const renderContent = () => {
    if (currentView === "settings") {
      return (
        <SettingsPage
          section={settingsSection}
          appConfigScrollTarget={appConfigScrollTarget}
          onImportSuccess={handleImportSuccess}
          onOpenApps={() => openPage("apps")}
          onOpenApp={selectApp}
        />
      );
    }
    return isAppPage(currentView) ? renderAppPage() : renderGlobalPage();
  };

  return (
    <NetworkRuntimeProvider active={navigation.domain === "network"} inShell>
      <CredentialMigrationNotice onImport={() => openSettings("data")} />
      <WindowControlsContext.Provider
        value={useAppWindowControls ? <WindowControls /> : null}
      >
        <WorkspaceFrame
          rail={<DomainRail domain={navigation.domain} onSelect={openDomain} />}
          directory={
            <Sidebar
              onResumeSetup={
                onboardingReturn && !onboardingOpen
                  ? () => requestNetworkLeave(() => setOnboardingOpen(true))
                  : undefined
              }
              domain={navigation.domain}
              networkTab={navigation.networkTab}
              onSelectNetworkTab={(tab) => networkNavigation.current?.(tab)}
              onSelectDomain={openDomain}
              activeApp={activeApp}
              view={currentView}
              visibleApps={visibleApps}
              settingsSection={settingsSection}
              onSelectApp={selectApp}
              onSelectPage={openPageFromNav}
              onSelectSettingsSection={(section) => {
                openSettings(section);
              }}
              onExitSettings={exitSettings}
              appsUpdateAvailable={
                checkToolUpdatesOnStartup && toolUpdatesAvailable
              }
            />
          }
          location={
            <>
              <CommandPalette
                isBusy={navigationBusy}
                onSelect={(target) =>
                  requestNetworkLeave(() => {
                    setCommandTarget(target);
                    if (target.kind === "app") selectApp(target.app);
                    else if (target.kind === "model") {
                      setActiveApp(target.app);
                      openPage("modelPicker");
                    } else if (target.kind === "node") {
                      openPage("network");
                      setNetworkTab("节点");
                    } else if (target.kind === "session") openPage("sessions");
                    else openPageFromNav(target.page);
                  })
                }
              />

              <span {...DRAG_REGION_ATTR}>
                {currentView === "settings"
                  ? t("nav.settings")
                  : navigation.domain === "model"
                    ? i18n.language.startsWith("zh")
                      ? "模型"
                      : "Models"
                    : navigation.domain === "network"
                      ? i18n.language.startsWith("zh")
                        ? "网络"
                        : "Network"
                      : i18n.language.startsWith("zh")
                        ? "概览"
                        : "Overview"}
              </span>
              <span {...DRAG_REGION_ATTR} aria-hidden>
                /
              </span>
              <span {...DRAG_REGION_ATTR} className="truncate text-fg-2">
                {currentView === "settings"
                  ? t(`settings.sections.${settingsSection}`)
                  : currentView === "network"
                    ? networkText(navigation.networkTab)
                    : isAppPage(currentView)
                      ? APP_DISPLAY_NAME[activeApp]
                      : currentView === "overview"
                        ? i18n.language.startsWith("zh")
                          ? "工作台"
                          : "Workspace"
                        : t(
                            `nav.${currentView === "skillsDiscovery" ? "skills" : currentView}`,
                          )}
              </span>
            </>
          }
          contentRef={mainScrollRef}
        >
          {showEnvBanner && envConflicts.length > 0 && (
            <EnvWarningBanner
              conflicts={envConflicts}
              onDismiss={() => {
                setShowEnvBanner(false);
                sessionStorage.setItem("env_banner_dismissed", "true");
              }}
              onDeleted={async () => {
                try {
                  const allConflicts = await checkAllEnvConflicts();
                  const flatConflicts = Object.values(allConflicts).flat();
                  setEnvConflicts(flatConflicts);
                  if (flatConflicts.length === 0) {
                    setShowEnvBanner(false);
                  }
                } catch (error) {
                  console.error(
                    "[App] Failed to re-check conflicts after deletion:",
                    error,
                  );
                }
              }}
            />
          )}
          <div
            key={
              currentView === "settings"
                ? "settings"
                : isAppPage(currentView)
                  ? "app"
                  : currentView
            }
            className="flex min-h-0 flex-1 flex-col"
          >
            {renderContent()}
          </div>
        </WorkspaceFrame>

        <AddProviderDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          appId={activeApp}
          onSubmit={addProvider}
          modeView={formModeView}
        />

        <EditProviderDialog
          open={Boolean(editingProvider)}
          provider={effectiveEditingProvider}
          onOpenChange={(open) => {
            if (!open) {
              setEditingProvider(null);
            }
          }}
          onSubmit={handleEditProvider}
          appId={activeApp}
          isProxyTakeover={isCurrentAppTakeoverActive}
          isCurrent={effectiveEditingProvider?.id === currentProviderId}
          modeView={formModeView}
        />

        {effectiveUsageProvider && (
          <UsageScriptModal
            key={effectiveUsageProvider.id}
            provider={effectiveUsageProvider}
            appId={activeApp}
            isOpen={Boolean(usageProvider)}
            onClose={() => setUsageProvider(null)}
            onSave={(script) => {
              if (usageProvider) {
                void saveUsageScript(usageProvider, script);
              }
            }}
          />
        )}

        <ConfirmDialog
          isOpen={Boolean(confirmAction)}
          title={
            confirmAction?.action === "remove"
              ? t("confirm.removeProvider")
              : t("confirm.deleteProvider")
          }
          message={confirmActionMessage}
          // 「移除」只是从应用配置里拿掉、Sivio 里还留着，可以再加回去，不用红色
          variant={confirmAction?.action === "remove" ? "info" : "destructive"}
          onConfirm={() => void handleConfirmAction()}
          onCancel={() => setConfirmAction(null)}
        />

        <ConfirmDialog
          isOpen={pendingLeave !== null}
          title={t("common.unsavedLeaveTitle")}
          message={t("common.unsavedLeaveMessage")}
          confirmText={t("common.unsavedLeaveConfirm")}
          cancelText={t("common.unsavedLeaveCancel")}
          zIndex="top"
          onConfirm={() => {
            const proceed = pendingLeave;
            setPendingLeave(null);
            discardUnsavedChanges();
            proceed?.();
          }}
          onCancel={() => setPendingLeave(null)}
        />

        <ConfirmDialog
          isOpen={launchDashboardOpen}
          title={t("hermes.webui.launchConfirmTitle")}
          message={t("hermes.webui.launchConfirmMessage")}
          confirmText={t("hermes.webui.launchConfirmAction")}
          variant="info"
          onConfirm={() => {
            setLaunchDashboardOpen(false);
            void (async () => {
              try {
                await hermesApi.launchDashboard();
                toast.success(t("hermes.webui.launching"));
              } catch (error) {
                toast.error(t("hermes.webui.launchFailed"), {
                  description: extractErrorMessage(error) || undefined,
                });
              }
            })();
          }}
          onCancel={() => setLaunchDashboardOpen(false)}
        />

        <DeepLinkImportDialog />
        {modelReturn && currentView !== "modelPicker" && (
          <Button
            className="fixed bottom-16 right-5 z-40"
            onClick={() =>
              requestNetworkLeave(() => {
                setModelReturn(false);
                openPage("modelPicker");
              })
            }
          >
            {i18n.language.startsWith("zh")
              ? "返回模型选择"
              : "Return to model selection"}
          </Button>
        )}
        {onboardingOpen && (
          <ClientOnboarding
            onClose={() => {
              setOnboardingOpen(false);
              setOnboardingReturn(false);
            }}
            onConfigure={(app) =>
              requestNetworkLeave(() => {
                setOnboardingOpen(false);
                setOnboardingReturn(true);
                selectApp(app);
              })
            }
            onInstall={() =>
              requestNetworkLeave(() => {
                setOnboardingOpen(false);
                setOnboardingReturn(true);
                openPage("apps");
              })
            }
            onVisibilitySaved={() => {
              void queryClient.invalidateQueries({ queryKey: ["settings"] });
            }}
          />
        )}
        <FirstRunNoticeDialog onSetup={() => setOnboardingOpen(true)} />
        <NewLayoutDialog />
        <WhatsNewNotice />
      </WindowControlsContext.Provider>
    </NetworkRuntimeProvider>
  );
}

export default App;
