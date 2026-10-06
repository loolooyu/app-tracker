import { DEFAULT_SETTINGS, type Draft, type ExtSettings, type QueueItem, type SavedRecord } from './types.js';

/**
 * Everything lives in chrome.storage.local so drafts and queued captures survive
 * service-worker shutdown and browser restarts. Each draft has its own key so the side
 * panel (editing) and service worker (creating) don't overwrite each other.
 */
export const KEYS = {
  settings: 'settings',
  token: 'pairingToken',
  draftIds: 'draftIds',
  activeDraft: 'activeDraftId',
  queue: 'queue',
  saved: 'recentlySaved',
  remCache: 'reminderCache',
  remDelivered: 'reminderDelivered',
  remFirstSeen: 'reminderFirstSeen',
  lastSync: 'lastReminderSync',
} as const;

const draftKey = (id: string) => `draft:${id}`;

async function get<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
async function set(key: string, value: unknown) {
  await chrome.storage.local.set({ [key]: value });
}

// Serialize read-modify-write updates within one extension context.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export const store = {
  async settings(): Promise<ExtSettings> {
    return { ...DEFAULT_SETTINGS, ...(await get<Partial<ExtSettings>>(KEYS.settings, {})) };
  },
  async saveSettings(patch: Partial<ExtSettings>) {
    return locked(async () => {
      const s = { ...(await store.settings()), ...patch };
      await set(KEYS.settings, s);
      return s;
    });
  },
  token: () => get<string | null>(KEYS.token, null),
  setToken: (t: string | null) => (t ? set(KEYS.token, t) : chrome.storage.local.remove(KEYS.token)),

  draftIds: () => get<string[]>(KEYS.draftIds, []),
  async drafts(): Promise<Draft[]> {
    const ids = await store.draftIds();
    if (!ids.length) return [];
    const r = await chrome.storage.local.get(ids.map(draftKey));
    return ids.map((id) => r[draftKey(id)] as Draft | undefined).filter((d): d is Draft => !!d);
  },
  async draft(id: string): Promise<Draft | null> {
    return get<Draft | null>(draftKey(id), null);
  },
  async putDraft(d: Draft) {
    await set(draftKey(d.id), d);
  },
  async addDraft(d: Draft) {
    return locked(async () => {
      await set(draftKey(d.id), d);
      const ids = (await store.draftIds()).filter((x) => x !== d.id);
      ids.unshift(d.id);
      await chrome.storage.local.set({ [KEYS.draftIds]: ids, [KEYS.activeDraft]: d.id });
    });
  },
  async removeDraft(id: string) {
    return locked(async () => {
      const ids = (await store.draftIds()).filter((x) => x !== id);
      await chrome.storage.local.remove(draftKey(id));
      const active = await get<string | null>(KEYS.activeDraft, null);
      await chrome.storage.local.set({ [KEYS.draftIds]: ids, [KEYS.activeDraft]: active === id ? (ids[0] ?? null) : active });
    });
  },
  activeDraftId: () => get<string | null>(KEYS.activeDraft, null),
  setActiveDraft: (id: string | null) => set(KEYS.activeDraft, id),

  queue: () => get<QueueItem[]>(KEYS.queue, []),
  updateQueue(fn: (q: QueueItem[]) => QueueItem[]) {
    return locked(async () => {
      const q = fn(await store.queue());
      await set(KEYS.queue, q);
      return q;
    });
  },
  saved: () => get<SavedRecord[]>(KEYS.saved, []),
  addSaved(r: SavedRecord) {
    return locked(async () => {
      const list = (await store.saved()).filter((x) => x.captureId !== r.captureId);
      list.unshift(r);
      await set(KEYS.saved, list.slice(0, 10));
    });
  },
  get,
  set,
};
