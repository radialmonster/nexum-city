import type { ThemeName } from '@nexum/theme';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applySettings, clampScale, loadSettings, saveSettings } from './runtime';

interface ThemeContextValue {
  readonly theme: ThemeName;
  readonly scale: number;
  readonly setTheme: (theme: ThemeName) => void;
  readonly setScale: (scale: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Owns the theme and scale settings and keeps the injected CSS variables in step. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
  }, [settings]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: settings.theme,
      scale: settings.scale,
      setTheme: (theme) => {
        setSettings((s) => ({ ...s, theme }));
      },
      setScale: (scale) => {
        setSettings((s) => ({ ...s, scale: clampScale(scale) }));
      },
    }),
    [settings],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
