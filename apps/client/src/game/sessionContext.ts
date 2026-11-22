import { createContext, useContext, useEffect, useState } from 'react';
import { themes } from '@nexum/theme';
import type { Session } from './session';

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('SessionContext is missing');
  return s;
}

/** True when the window is narrower than the compact breakpoint: side columns become drawers. */
export function useCompact(): boolean {
  const below = themes.neon.map.compactBelowPx;
  const [compact, setCompact] = useState(() => window.innerWidth < below);
  useEffect(() => {
    const on = () => {
      setCompact(window.innerWidth < below);
    };
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
    };
  }, [below]);
  return compact;
}

/** Wall-clock time, refreshed every `everyMs`. */
export function useWallClock(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, everyMs);
    return () => {
      clearInterval(id);
    };
  }, [everyMs]);
  return now;
}
