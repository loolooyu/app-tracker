/**
 * Appfolio service worker.
 * - Capture: the toolbar click / Alt+Shift+S grants activeTab for the current tab. We open
 *   the side panel (must happen synchronously in the gesture) and inject the capture script.
 * - Queue: reviewed captures are queued in chrome.storage.local and sent to the local API;
 *   each has a stable capture ID so retries can't create duplicates.
 * - Reminders: assessment deadlines are fetched from the API and turned into chrome.alarms.
 *   Definitions live in the API; alarms are reconciled on startup, pairing and every sync.
 */
import { planReminders, reconcileReminders, relativeDue, type CaptureResult, type ReminderSource } from '@appfolio/shared';
import type { ExtractedJob } from '@appfolio/shared/extract';
import { apiFetch, dashboardUrl, ExtApiError } from './lib/api.js';
import { capturePayload, draftFromExtraction, emptyForm, failedDraft } from './lib/draft.js';
import { KEYS, store } from './lib/storage.js';
import { MESSAGE_TYPES, type Draft, type PanelMessage, type QueueItem, type SubmitOutcome } from './lib/types.js';

const QUEUE_ALARM = 'queue-retry';
const SYNC_ALARM = 'reminder-sync';
const REM_PREFIX = 'rem|';

// ---------------- Capture ----------------

chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open must be called synchronously within the user gesture.
  if (tab.id !== undefined) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined));
  }
  void captureTab(tab);
});

export async function captureTab(tab: chrome.tabs.Tab): Promise<Draft> {
  const id = crypto.randomUUID();
  const url = tab.url ?? '';
  if (!tab.id || !/^https?:/i.test(url)) {
    const d = failedDraft(id, url, tab.title ?? null, 'Chrome doesn’t let extensions read this kind of page (for example chrome:// pages, the Web Store, or PDFs). Paste the job description instead.');
    await store.addDraft(d);
    return d;
  }
  try {
    const settings = await store.settings();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (hosts: string[]) => (globalThis as unknown as { __appfolioCapture: (o: { nuworksHosts: string[] }) => Promise<unknown> }).__appfolioCapture({ nuworksHosts: hosts }),
      args: [settings.nuworksHosts],
    });
    const extracted = validateExtraction(res?.result);
    const d = draftFromExtraction(id, extracted, tab.title ?? null);
    await store.addDraft(d);
    return d;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const friendly = /Cannot access|permission|activeTab/i.test(msg)
      ? 'Appfolio no longer has access to this tab (access ends when you navigate). Click the Appfolio toolbar icon on the job page again.'
      : `Couldn’t read this page: ${msg.slice(0, 160)}. You can paste the job description instead.`;
    const d = failedDraft(id, url, tab.title ?? null, friendly);
    await store.addDraft(d);
    return d;
  }
}

/** The content script's result is untrusted page-derived data: check its shape and types. */
function validateExtraction(v: unknown): ExtractedJob {
  const o = v as Partial<ExtractedJob> | null;
  const str = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : null);
  if (!o || typeof o !== 'object' || typeof o.text !== 'string' || typeof o.url !== 'string') throw new Error('Capture returned no usable result');
  const methods = ['adapter', 'structured_data', 'generic_dom', 'selected_text', 'manual_paste'];
  return {
    url: o.url.slice(0, 4096),
    platform: (o.platform as ExtractedJob['platform']) ?? 'other',
    adapter: {
      id: str(o.adapter?.id, 40) ?? 'other',
      label: str(o.adapter?.label, 80) ?? 'Generic',
      supportLevel: (['verified', 'fixture', 'generic', 'manual'].includes(String(o.adapter?.supportLevel)) ? o.adapter!.supportLevel : 'generic') as ExtractedJob['adapter']['supportLevel'],
      matched: !!o.adapter?.matched,
    },
    company: str(o.company, 200),
    title: str(o.title, 300),
    location: str(o.location, 200),
    jobId: str(o.jobId, 200),
    employmentType: str(o.employmentType, 100),
    pageTitle: str(o.pageTitle, 500),
    // Not truncated: oversize text is flagged in review rather than silently cut.
    text: o.text,
    method: (methods.includes(String(o.method)) ? o.method : 'generic_dom') as ExtractedJob['method'],
    warnings: Array.isArray(o.warnings) ? o.warnings.filter((w) => typeof w === 'string').slice(0, 20).map((w) => w.slice(0, 300)) : [],
    alternatives: Array.isArray(o.alternatives)
      ? o.alternatives.filter((a) => a && typeof a.text === 'string' && methods.includes(String(a.method))).slice(0, 15).map((a) => ({
          method: a.method,
          label: String(a.label).slice(0, 80),
          text: a.text,
          ...(a.meta && typeof a.meta === 'object'
            ? { meta: { title: str(a.meta.title, 300), company: str(a.meta.company, 200), location: str(a.meta.location, 200), jobId: str(a.meta.jobId, 200) } }
            : {}),
        }))
      : [],
    postings: Array.isArray(o.postings) ? o.postings.slice(0, 20).map((p) => ({ title: str(p?.title, 300), company: str(p?.company, 200), location: str(p?.location, 200) })) : [],
  };
}

async function captureActiveTab(): Promise<Draft> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('No active tab');
  return captureTab(tab);
}

// ---------------- Queue ----------------

let flushing: Promise<void> | null = null;

export async function submitDraft(id: string): Promise<SubmitOutcome> {
  const d = await store.draft(id);
  if (!d) return { state: 'rejected', reason: 'This draft no longer exists.' };
  if (d.form.rememberNuworksHost) {
    const host = safeHost(d.form.url);
    if (host) {
      const s = await store.settings();
      if (!s.nuworksHosts.includes(host)) await store.saveSettings({ nuworksHosts: [...s.nuworksHosts, host] });
    }
  }
  const item: QueueItem = {
    captureId: d.id,
    payload: capturePayload(d),
    summary: { title: d.form.mode === 'link' ? (d.form.linkApplicationLabel ?? 'Linked page') : d.form.title, company: d.form.company, mode: d.form.mode },
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    state: 'pending',
    draft: d,
  };
  // Move draft → queue first, so a crash after this point still keeps the capture.
  await store.updateQueue((q) => [...q.filter((x) => x.captureId !== item.captureId), item]);
  await store.removeDraft(d.id);
  await flushQueue();
  const saved = (await store.saved()).find((r) => r.captureId === d.id);
  if (saved) return { state: 'saved', record: saved };
  const still = (await store.queue()).find((x) => x.captureId === d.id);
  if (still?.state === 'attention') return { state: 'rejected', reason: still.lastError ?? 'The server rejected this capture.' };
  return { state: 'queued', reason: still?.lastError ?? 'The Appfolio server is not reachable.' };
}

export function flushQueue(): Promise<void> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

async function doFlush() {
  const queue = await store.queue();
  for (const item of queue.filter((q) => q.state === 'pending')) {
    try {
      const result = await apiFetch<CaptureResult>('/api/captures', { method: 'POST', body: item.payload, timeoutMs: 15_000 });
      await store.addSaved({ captureId: item.captureId, result, title: item.summary.title, company: item.summary.company, at: new Date().toISOString() });
      // Remove only after the server acknowledged it.
      await store.updateQueue((q) => q.filter((x) => x.captureId !== item.captureId));
    } catch (e) {
      const err = e instanceof ExtApiError ? e : new ExtApiError(0, 'offline', String(e));
      const attention = !err.retryable && err.code !== 'unpaired' && err.status !== 401;
      await store.updateQueue((q) =>
        q.map((x) =>
          x.captureId === item.captureId
            ? { ...x, attempts: x.attempts + 1, lastAttemptAt: new Date().toISOString(), lastError: err.message, state: attention ? 'attention' : 'pending' }
            : x,
        ),
      );
      if (err.retryable || err.status === 401) break; // server down or unpaired: try the rest later
    }
  }
  // A successful send means the server is reachable again: refresh reminder schedules too.
  if (queue.length && (await store.queue()).length < queue.length) void syncReminders();
  const remaining = (await store.queue()).filter((q) => q.state === 'pending').length;
  if (remaining) await chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 1 });
  else await chrome.alarms.clear(QUEUE_ALARM);
  await updateBadge();
}

async function updateBadge() {
  const pending = (await store.queue()).length;
  await chrome.action.setBadgeText({ text: pending ? String(pending) : '' });
  if (pending) await chrome.action.setBadgeBackgroundColor({ color: '#B45309' });
  await chrome.action.setTitle({ title: pending ? `Appfolio: ${pending} capture(s) waiting to sync` : 'Capture this job with Appfolio (Alt+Shift+S)' });
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ---------------- Reminders ----------------

interface ReminderCache {
  fetchedAt: string;
  items: ReminderSource[];
}

async function hasNotificationPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ['notifications'] });
}

/** Fetch the schedule (or fall back to the cached one if the API is down) and reconcile alarms. */
export async function syncReminders(): Promise<{ ok: boolean; stale: boolean; scheduled: number }> {
  let cache = await store.get<ReminderCache | null>(KEYS.remCache, null);
  let stale = false;
  if (await store.token()) {
    try {
      const r = await apiFetch<{ generatedAt: string; items: ReminderSource[] }>('/api/reminders/schedule');
      cache = { fetchedAt: r.generatedAt, items: r.items };
      await store.set(KEYS.remCache, cache);
      await store.set(KEYS.lastSync, new Date().toISOString());
    } catch {
      stale = true;
    }
  }
  const settings = await store.settings();
  const enabled = settings.notifications && (await hasNotificationPermission());
  const existing = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith(REM_PREFIX));
  if (!enabled || !cache) {
    for (const a of existing) await chrome.alarms.clear(a.name);
    return { ok: !stale, stale, scheduled: 0 };
  }
  const now = Date.now();
  const firstSeenObj = await store.get<Record<string, number>>(KEYS.remFirstSeen, {});
  for (const i of cache.items) {
    const k = `${i.assessmentId}|${new Date(i.dueAt).getTime()}`;
    if (!(k in firstSeenObj)) firstSeenObj[k] = now;
  }
  const delivered = new Set(await store.get<string[]>(KEYS.remDelivered, []));
  const plan = planReminders(cache.items);
  const result = reconcileReminders(plan, { delivered, firstSeen: new Map(Object.entries(firstSeenObj)) }, now);

  const wanted = new Set(result.schedule.map((r) => r.key));
  for (const a of existing) if (!wanted.has(a.name)) await chrome.alarms.clear(a.name);
  const have = new Set(existing.map((a) => a.name));
  for (const r of result.schedule) {
    if (!have.has(r.key)) await chrome.alarms.create(r.key, { when: r.fireAt });
  }
  // Skipped reminders (already past when first seen) are marked so they never fire later.
  for (const s of result.skipped) delivered.add(s.key);
  // Missed while Chrome was closed/asleep: one combined notice, not a flood.
  if (result.missed.length) {
    const items = result.missed.map((m) => cache!.items.find((i) => i.assessmentId === m.assessmentId)).filter(Boolean) as ReminderSource[];
    await notify(
      `missed|${now}`,
      result.missed.length === 1 ? `Coming up: ${items[0].title}` : `${result.missed.length} assessments coming up`,
      items.map((i) => `${i.company}: ${i.title} — due ${relativeDue(i.dueAt).text}`).join('\n'),
      items.length === 1 ? items[0].applicationId : null,
    );
    for (const m of result.missed) delivered.add(m.key);
  }
  // Keep only keys that still matter.
  const live = new Set(plan.map((p) => p.key));
  await store.set(KEYS.remDelivered, [...delivered].filter((k) => live.has(k)));
  const liveSeen = new Set(cache.items.map((i) => `${i.assessmentId}|${new Date(i.dueAt).getTime()}`));
  await store.set(KEYS.remFirstSeen, Object.fromEntries(Object.entries(firstSeenObj).filter(([k]) => liveSeen.has(k))));
  if (await store.token()) {
    apiFetch('/api/extension/heartbeat', { method: 'POST', body: { reminderSync: !stale } }).catch(() => undefined);
  }
  return { ok: !stale, stale, scheduled: result.schedule.length };
}

async function fireReminder(key: string) {
  const delivered = new Set(await store.get<string[]>(KEYS.remDelivered, []));
  if (delivered.has(key)) return;
  const [, assessmentId] = key.split('|');
  const cache = await store.get<ReminderCache | null>(KEYS.remCache, null);
  const item = cache?.items.find((i) => i.assessmentId === assessmentId);
  // Re-check with the latest cached state: completed or rescheduled tasks don't notify.
  if (!item || item.completed || !key.startsWith(`${REM_PREFIX}${assessmentId}|${new Date(item.dueAt).getTime()}|`)) return;
  if (!(await store.settings()).notifications || !(await hasNotificationPermission())) return;
  delivered.add(key);
  await store.set(KEYS.remDelivered, [...delivered]);
  await notify(key, `${item.title} — due ${relativeDue(item.dueAt).text}`, `${item.company}. Due ${new Date(item.dueAt).toLocaleString(undefined, { timeZone: item.timezone, dateStyle: 'medium', timeStyle: 'short' })} (${item.timezone}).`, item.applicationId);
}

const notificationTargets = new Map<string, string>();

async function notify(id: string, title: string, message: string, applicationId: string | null) {
  if (!chrome.notifications) return;
  if (applicationId) notificationTargets.set(id, applicationId);
  await chrome.storage.session.set({ [`notif:${id}`]: applicationId }).catch(() => undefined);
  await chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title: title.slice(0, 120), message: message.slice(0, 400), priority: 1 });
}

function registerNotificationClick() {
  if (!chrome.notifications || registerNotificationClick.done) return;
  registerNotificationClick.done = true;
  // Opening a notification only opens the application packet; it never submits anything.
  chrome.notifications.onClicked.addListener(async (id) => {
    const stored = (await chrome.storage.session.get(`notif:${id}`))[`notif:${id}`] as string | null | undefined;
    const appId = notificationTargets.get(id) ?? stored ?? null;
    await chrome.tabs.create({ url: await dashboardUrl(appId ?? undefined) });
    chrome.notifications.clear(id);
  });
}
registerNotificationClick.done = false;
registerNotificationClick();
chrome.permissions.onAdded.addListener(() => {
  registerNotificationClick();
  void syncReminders();
});

// ---------------- Lifecycle & messages ----------------

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === QUEUE_ALARM) void flushQueue();
  else if (alarm.name === SYNC_ALARM) void syncReminders();
  else if (alarm.name.startsWith(REM_PREFIX)) void fireReminder(alarm.name);
});

async function startup() {
  // Recreate the periodic alarm every start: alarms may not survive browser restarts.
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 15 });
  await flushQueue();
  await syncReminders();
}
chrome.runtime.onStartup.addListener(() => void startup());
chrome.runtime.onInstalled.addListener(() => void startup());

chrome.runtime.onMessage.addListener((msg: PanelMessage, sender, sendResponse) => {
  // Only the extension's own pages may talk to the worker. Content scripts report the web
  // page's URL as sender.url, and web pages can't reach runtime.onMessage at all.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return false;
  if (!msg || typeof msg !== 'object' || !MESSAGE_TYPES.has(msg.type)) return false;
  handle(msg).then(
    (r) => sendResponse({ ok: true, result: r }),
    (e) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) }),
  );
  return true;
});

async function handle(msg: PanelMessage): Promise<unknown> {
  switch (msg.type) {
    case 'capture-active-tab':
      return captureActiveTab();
    case 'new-manual-draft': {
      const d: Draft = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: { url: '', title: null }, extracted: null, captureError: null, form: emptyForm() };
      await store.addDraft(d);
      return d;
    }
    case 'discard-draft':
      return store.removeDraft(String(msg.id));
    case 'submit-draft':
      return submitDraft(String(msg.id));
    case 'flush-queue':
      return flushQueue();
    case 'delete-queued':
      await store.updateQueue((q) => q.filter((x) => x.captureId !== msg.captureId));
      return updateBadge();
    case 'queued-to-draft': {
      const item = (await store.queue()).find((x) => x.captureId === msg.captureId);
      if (!item) return null;
      await store.addDraft({ ...item.draft, form: { ...item.draft.form, reviewed: false } });
      await store.updateQueue((q) => q.filter((x) => x.captureId !== msg.captureId));
      await updateBadge();
      return item.draft.id;
    }
    case 'sync-reminders':
      return syncReminders();
  }
}

// Debug/test hook, reachable only from the extension's own contexts (e.g. the service
// worker console). Not exposed to web pages.
(globalThis as unknown as Record<string, unknown>).__appfolio = { captureTab, flushQueue, syncReminders, submitDraft };
