export const desktopActions = [
  "open_or_close_dashboard",
  "clash_mode_rule",
  "clash_mode_global",
  "clash_mode_direct",
  "toggle_system_proxy",
  "toggle_tun_mode",
  "entry_lightweight_mode",
  "reactivate_profiles",
  "quit",
  "hide",
] as const;
export const menuPages = [
  "overview",
  "network",
  "mcp",
  "skills",
  "prompts",
  "sessions",
  "auth",
  "usage",
] as const;
export type MenuPage = (typeof menuPages)[number];
export type DesktopPreferences = {
  startPage: string;
  autoLightweightMinutes: number;
  globalShortcutsEnabled: boolean;
  hotkeys: Partial<Record<(typeof desktopActions)[number], string>>;
  trayClickAction: "menu" | "window";
  trayIcon: "template" | "color";
  trafficGraph: boolean;
  memoryUsage: boolean;
  groupIcons: boolean;
  pauseTrafficOnBlur: boolean;
  proxyColumns: number;
  groupToolsPosition: "left" | "right";
  menuIcon: "monochrome" | "colorful" | "disable";
  menuOrder: MenuPage[];
  hoverGroupNavigation: boolean;
  hoverGroupDelay: number;
  envType: "bash" | "fish" | "cmd" | "powershell" | "nushell";
  autoCheckUpdate: boolean;
  logMaxSizeMib: number;
  logArchiveCount: number;
  logCleanDays: number;
  autoBackupOnChange: boolean;
  traySpeed: boolean;
  trayGroupsMode: "default" | "inline" | "disable";
  trayInlineModes: boolean;
  trayNormalImage: string | null;
  trayNormalImageEnabled: boolean;
  trayProxyImage: string | null;
  trayProxyImageEnabled: boolean;
  trayTunImage: string | null;
  trayTunImageEnabled: boolean;
  homeCards: ("usage" | "router" | "network" | "providers")[];
};
export type DesktopSnapshot = {
  preferences: DesktopPreferences;
  revision: string | null;
  registrationError?: string | null;
  startupScript?: { state: string; path?: string; error?: string };
  localBackup?: { at: number; file?: string; error?: string | null } | null;
};
export const defaultDesktopPreferences: DesktopPreferences = {
  startPage: "remember",
  autoLightweightMinutes: 0,
  globalShortcutsEnabled: false,
  hotkeys: {},
  trayClickAction: "menu",
  trayIcon: "template",
  trafficGraph: true,
  memoryUsage: true,
  groupIcons: true,
  pauseTrafficOnBlur: true,
  proxyColumns: 3,
  groupToolsPosition: "right",
  menuIcon: "monochrome",
  menuOrder: [],
  hoverGroupNavigation: true,
  hoverGroupDelay: 500,
  envType: "bash",
  autoCheckUpdate: true,
  logMaxSizeMib: 10,
  logArchiveCount: 4,
  logCleanDays: 7,
  autoBackupOnChange: false,
  traySpeed: false,
  trayGroupsMode: "default",
  trayInlineModes: false,
  trayNormalImage: null,
  trayNormalImageEnabled: false,
  trayProxyImage: null,
  trayProxyImageEnabled: false,
  trayTunImage: null,
  trayTunImageEnabled: false,
  homeCards: ["usage", "router", "network", "providers"],
};
/** Missing pages are appended, so a new release never loses an entry from an older order. */
export function orderedMenuPages(order: MenuPage[]): MenuPage[] {
  return [
    ...new Set([
      ...order.filter((page) => menuPages.includes(page)),
      ...menuPages,
    ]),
  ];
}
