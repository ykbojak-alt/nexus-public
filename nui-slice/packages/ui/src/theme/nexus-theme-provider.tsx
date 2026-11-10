'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { resolveTheme, type NexusThemeId, type ResolvedNexusTheme } from '@nexus/themes';

/* SSR-safe: useLayoutEffect warns on the server; document mirror runs on
   the client anyway. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const ThemeCtx = createContext<ResolvedNexusTheme>(resolveTheme('nexus'));

export function useNexusTheme(): ResolvedNexusTheme {
  return useContext(ThemeCtx);
}

export interface NexusThemeProviderProps {
  className?: string;
  /** Canonical or extension theme id; unknown ids resolve to 'nexus'. */
  theme: NexusThemeId;
  density?: 'calm' | 'standard' | 'dense';
  children: ReactNode;
}

/**
 * Sets data-theme/data-density on the wrapper and provides the resolved
 * theme via context. Components never branch on theme ids — they read
 * tokens/CSS vars (spec §7).
 */
export function NexusThemeProvider({ className, theme, density = 'standard', children }: NexusThemeProviderProps) {
  const resolved = useMemo(() => resolveTheme(theme), [theme]);
  /* W2-129: mirror theme/density onto <html> before paint. The document
     canvas (background/color/color-scheme on the `html` rule + themed
     scrollbars) then follows the persona in the same frame as the app's
     own data-theme swap — atomic, no white flash, no transition needed. */
  useIsoLayoutEffect(() => {
    const root = document.documentElement;
    const prev = {
      theme: root.dataset.theme,
      density: root.dataset.density,
      colorScheme: root.style.colorScheme,
    };
    root.dataset.theme = resolved.id;
    root.dataset.density = density;
    root.style.colorScheme = resolved.id === 'alice' ? 'light' : 'dark';
    return () => {
      if (prev.theme === undefined) delete root.dataset.theme;
      else root.dataset.theme = prev.theme;
      if (prev.density === undefined) delete root.dataset.density;
      else root.dataset.density = prev.density;
      root.style.colorScheme = prev.colorScheme;
    };
  }, [resolved.id, density]);
  return (
    <ThemeCtx.Provider value={resolved}>
      <div data-theme={resolved.id} data-density={density} data-nexus-root="" className={className}>
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}
