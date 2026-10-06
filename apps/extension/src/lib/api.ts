import { store } from './storage.js';

/** Only loopback HTTP origins are accepted, so the extension can never be pointed at a remote server. */
export function validApiBase(input: string): string | null {
  const m = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})\/?$/.exec(input.trim());
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1024 || port > 65535) return null;
  return `http://${m[1]}:${port}`;
}

export class ExtApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** Network failure or server not running: worth retrying later. */
  get retryable() {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

/**
 * The only network path in the extension: fixed loopback base + a known API path.
 * There is deliberately no generic "fetch any URL" helper.
 */
export async function apiFetch<T>(path: `/api/${string}`, init: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const settings = await store.settings();
  const base = validApiBase(settings.apiBase);
  if (!base) throw new ExtApiError(0, 'bad_base', 'The Appfolio server address must be http://127.0.0.1:<port> or http://localhost:<port>.');
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.auth !== false) {
    const token = await store.token();
    if (!token) throw new ExtApiError(401, 'unpaired', 'This extension isn’t paired with Appfolio yet.');
    headers.Authorization = `Bearer ${token}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ExtApiError(0, 'offline', 'Can’t reach the Appfolio server on this computer. Is it running?');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ExtApiError(res.status, err?.code ?? 'error', err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function dashboardUrl(applicationId?: string) {
  const s = await store.settings();
  const base = validApiBase(s.apiBase) ?? 'http://127.0.0.1:4317';
  return applicationId ? `${base}/#/applications/${encodeURIComponent(applicationId)}` : `${base}/`;
}
