export const APPEARANCE_CACHE = "si-assist-appearance";
export const APPEARANCE_SAFE_MODE = "si-assist-appearance-safe-mode";
export function appearanceSafeMode() {
  try {
    return Boolean(localStorage.getItem(APPEARANCE_SAFE_MODE));
  } catch {
    return false;
  }
}
export function cacheAppearance(value: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_CACHE, JSON.stringify(value));
  } catch {
    /* The database remains authoritative if the optional cache is full. */
  }
}
export function setAppearanceSafeMode(enabled: boolean) {
  try {
    if (enabled) {
      localStorage.setItem(APPEARANCE_SAFE_MODE, "1");
      localStorage.removeItem(APPEARANCE_CACHE);
    } else localStorage.removeItem(APPEARANCE_SAFE_MODE);
  } catch {
    /* Keep the in-memory recovery path working. */
  }
}
export const noticePositions = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type Appearance = {
  fontFamily: string;
  fontSize: number;
  editorFontFamily: string;
  editorFontSize: number;
  accent: string;
  css: string;
  noticePosition: (typeof noticePositions)[number];
};
export type AppearanceSnapshot = {
  preferences: Appearance;
  revision: string | null;
};
export const defaultAppearance: Appearance = {
  fontFamily: "",
  fontSize: 0,
  editorFontFamily: "",
  editorFontSize: 0,
  accent: "",
  css: "",
  noticePosition: "bottom-center",
};
export function validateAppearance(candidate: Appearance): Appearance {
  const value = { ...defaultAppearance, ...candidate };
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  for (const font of [value.fontFamily, value.editorFontFamily])
    if (
      typeof font !== "string" ||
      bytes(font) > 160 ||
      !/^[\p{L}\p{N} .,_-]*$/u.test(font)
    )
      throw new Error("Invalid font name");
  if (
    ![value.fontSize, value.editorFontSize].every(Number.isInteger) ||
    (value.fontSize !== 0 && (value.fontSize < 11 || value.fontSize > 24)) ||
    (value.editorFontSize !== 0 &&
      (value.editorFontSize < 10 || value.editorFontSize > 32))
  )
    throw new Error("Invalid font size");
  if (
    typeof value.accent !== "string" ||
    (value.accent !== "" && !/^#[\da-f]{6}$/i.test(value.accent))
  )
    throw new Error("Invalid accent color");
  if (!noticePositions.includes(value.noticePosition))
    throw new Error("Invalid notification position");
  if (
    typeof value.css !== "string" ||
    bytes(value.css) > 32768 ||
    /\\|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]|(?:url|image-set)\s*\(|@import|(?:https?|file|asset|data):/i.test(
      value.css,
    )
  )
    throw new Error(
      "CSS supports local styles only; external resources, imports and escapes are not allowed",
    );
  return value;
}
export function readCachedAppearance(): Appearance {
  try {
    if (localStorage.getItem(APPEARANCE_SAFE_MODE))
      return { ...defaultAppearance };
    return validateAppearance(
      JSON.parse(localStorage.getItem(APPEARANCE_CACHE) ?? "{}"),
    );
  } catch {
    return { ...defaultAppearance };
  }
}
function hsl(hex: string) {
  const values = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const [r, g, b] = values;
  const high = Math.max(...values);
  const low = Math.min(...values);
  const delta = high - low;
  const lightness = (high + low) / 2;
  let hue = 0;
  if (delta)
    hue =
      high === r
        ? ((g - b) / delta) % 6
        : high === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  return `${(hue * 60 + 360) % 360} ${delta ? (delta / (1 - Math.abs(2 * lightness - 1))) * 100 : 0}% ${lightness * 100}%`;
}
export function applyAppearance(value: Appearance) {
  value = validateAppearance(value);
  let style = document.querySelector<HTMLStyleElement>("#si-assist-appearance");
  if (!style) {
    style = document.createElement("style");
    style.id = "si-assist-appearance";
    document.head.append(style);
  }
  let css = "";
  if (value.accent) {
    const rgb = [1, 3, 5]
      .map((index) => parseInt(value.accent.slice(index, index + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const foreground = luminance > 0.179 ? "#202124" : "#ffffff";
    const textLight =
      1.05 / (luminance + 0.05) >= 4.5 ? value.accent : "#202124";
    const textDark =
      (luminance + 0.05) / 0.06 >= 4.5 ? value.accent : "#f1f1f4";
    css += `:root,:root.dark{--action-bg:${value.accent};--action-hover:${value.accent};--action-fg:${foreground};--primary-foreground:${hsl(foreground)};--action-soft:${value.accent}22}:root{--primary:${hsl(textLight)};--ring:${hsl(textLight)};--action-text:${textLight}}:root.dark{--primary:${hsl(textDark)};--ring:${hsl(textDark)};--action-text:${textDark}}`;
  }
  if (value.fontSize) css += `:root{font-size:${value.fontSize}px}`;
  if (value.fontFamily)
    css += `body,button,input,select{font-family:${JSON.stringify(value.fontFamily)},system-ui,sans-serif}`;
  if (value.editorFontSize)
    css += `.cm-editor{font-size:${value.editorFontSize}px!important}`;
  if (value.editorFontFamily)
    css += `.cm-editor .cm-content{font-family:${JSON.stringify(value.editorFontFamily)},monospace!important}`;
  style.textContent = `${css}\n${value.css}`;
}
