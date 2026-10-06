import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browserTimeZone, type Settings, type Summary, type SystemStatus } from '@appfolio/shared';
import { api, ApiError } from './api';

export type Connection = 'checking' | 'online' | 'offline';

interface AppState {
  connection: Connection;
  settings: Settings | null;
  /** Zone used to display times: the user's override or the browser's zone. */
  tz: string;
  summary: Summary | null;
  status: SystemStatus | null;
  /** Bump to make views reload their data after a change elsewhere. */
  version: number;
  refresh: () => void;
  setSettings: (s: Settings) => void;
  reportError: (e: unknown) => string;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection>('checking');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [st, su, sys] = await Promise.all([api.settings(), api.summary(), api.status()]);
      setSettings(st);
      setSummary(su);
      setStatus(sys);
      setConnection('online');
    } catch (e) {
      if (e instanceof ApiError && e.offline) setConnection('offline');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, version]);

  // Re-check connectivity periodically and when the tab regains focus.
  useEffect(() => {
    const check = async () => {
      try {
        await api.health();
        setConnection((c) => {
          if (c === 'offline') setVersion((v) => v + 1);
          return 'online';
        });
      } catch {
        setConnection('offline');
      }
    };
    const t = setInterval(check, 15_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', check);
    };
  }, []);

  const reportError = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.offline) setConnection('offline');
      return e.message;
    }
    return 'Something went wrong.';
  }, []);

  const value = useMemo<AppState>(
    () => ({
      connection,
      settings,
      tz: settings?.timezone || browserTimeZone(),
      summary,
      status,
      version,
      refresh: () => setVersion((v) => v + 1),
      setSettings,
      reportError,
    }),
    [connection, settings, summary, status, version, reportError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
