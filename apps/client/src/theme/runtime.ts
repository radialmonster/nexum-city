import { SCALE_USER_VAR, scaleCss, themes, toCssVariables, type ThemeName } from '@nexum/theme';

export const STYLE_ELEMENT_ID = 'nexum-theme';
const STORAGE_KEY = 'nexum.settings';

export const SCALE_MIN = 0.75;
export const SCALE_MAX = 1.5;

export interface Settings {
  readonly theme: ThemeName;
  /** The player's own UI scale, written to `--s-user`. */
  readonly scale: number;
}

export const defaultSettings: Settings = { theme: 'neon', scale: 1 };

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && Object.hasOwn(themes, value);
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

/** The CSS for a theme: every token as a custom property, plus the `--s` scale rules. */
export function themeCss(name: ThemeName): string {
  const theme = themes[name];
  return `${toCssVariables(theme)}\n${scaleCss(theme)}`;
}

/** Inject (or replace) the theme `<style>` element and mark the active theme on `<html>`. */
export function applyTheme(name: ThemeName, doc: Document = document): void {
  let style = doc.getElementById(STYLE_ELEMENT_ID);
  if (style === null) {
    style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    doc.head.prepend(style);
  }
  style.textContent = themeCss(name);
  doc.documentElement.dataset['theme'] = name;
}

/** Set the player's scale setting (`--s-user`) inline on `<html>`. */
export function applyUserScale(scale: number, doc: Document = document): void {
  doc.documentElement.style.setProperty(SCALE_USER_VAR, String(clampScale(scale)));
}

export function applySettings(settings: Settings, doc: Document = document): void {
  applyTheme(settings.theme, doc);
  applyUserScale(settings.scale, doc);
}

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultSettings;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaultSettings;
    const { theme, scale } = parsed as Record<string, unknown>;
    return {
      theme: isThemeName(theme) ? theme : defaultSettings.theme,
      scale: typeof scale === 'number' ? clampScale(scale) : defaultSettings.scale,
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage can be blocked; the settings just do not persist
  }
}
