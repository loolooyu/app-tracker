import { useCallback, useEffect, useState } from 'react';
import { KEYS, store } from '../lib/storage.js';
import type { Draft, ExtSettings, PanelMessage, QueueItem, SavedRecord } from '../lib/types.js';

export interface PanelState {
  loaded: boolean;
  settings: ExtSettings | null;
  paired: boolean;
  drafts: Draft[];
  activeId: string | null;
  queue: QueueItem[];
  saved: SavedRecord[];
  lastSync: string | null;
}

/** Mirror chrome.storage.local into React state; refresh whenever it changes. */
export function usePanelState(): PanelState & { reload: () => Promise<void> } {
  const [s, setS] = useState<PanelState>({ loaded: false, settings: null, paired: false, drafts: [], activeId: null, queue: [], saved: [], lastSync: null });
  const reload = useCallback(async () => {
    const [settings, token, drafts, activeId, queue, saved, lastSync] = await Promise.all([
      store.settings(),
      store.token(),
      store.drafts(),
      store.activeDraftId(),
      store.queue(),
      store.saved(),
      store.get<string | null>(KEYS.lastSync, null),
    ]);
    setS({ loaded: true, settings, paired: !!token, drafts, activeId: activeId && drafts.some((d) => d.id === activeId) ? activeId : (drafts[0]?.id ?? null), queue, saved, lastSync });
  }, []);
  useEffect(() => {
    void reload();
    const on = (_c: unknown, area: string) => {
      if (area === 'local') void reload();
    };
    chrome.storage.onChanged.addListener(on);
    return () => chrome.storage.onChanged.removeListener(on);
  }, [reload]);
  return { ...s, reload };
}

export async function send<T = unknown>(msg: PanelMessage): Promise<T> {
  const r = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; result?: T; error?: string } | undefined;
  if (!r) throw new Error('The extension background worker did not respond. Try again.');
  if (!r.ok) throw new Error(r.error ?? 'Failed');
  return r.result as T;
}
