import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type APIRequestContext } from '@playwright/test';

const ROOT = new URL('../../', import.meta.url).pathname;

export function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export interface Api {
  port: number;
  base: string;
  dataDir: string;
  stop(): Promise<void>;
}

export async function startApi(dataDir: string, port: number): Promise<Api> {
  const child: ChildProcess = spawn(process.execPath, [join(ROOT, 'apps/api/dist/main.js'), '--data-dir', dataDir, '--port', String(port)], {
    env: { ...process.env, APPFOLIO_LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (d) => (output += d));
  child.stderr?.on('data', (d) => (output += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error('API exited: ' + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    port,
    base,
    dataDir,
    async stop() {
      if (child.exitCode !== null) return;
      const done = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      await done;
    },
  };
}

/** Headers a same-origin dashboard request carries, for test setup calls. */
export function dashHeaders(api: Api) {
  return { Origin: api.base, 'X-Appfolio-Client': 'dashboard' };
}

export async function apiJson<T = any>(request: APIRequestContext, api: Api, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = dashHeaders(api);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await request.fetch(api.base + path, { method, headers, data: body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Serve tests/fixtures/pages on 127.0.0.1 (synthetic job pages). */
export async function startFixtureServer(port: number): Promise<{ url: (name: string) => string; stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '').split('/').pop() ?? '';
    if (!/^[a-z0-9-]+\.html$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = readFileSync(join(ROOT, 'tests/fixtures/pages', name));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  return {
    url: (name) => `http://127.0.0.1:${port}/${name}`,
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

export const EXTENSION_DIST = join(ROOT, 'apps/extension/dist');

/**
 * Launch the installed Google Chrome with the real unpacked extension, loaded through the
 * CDP Extensions.loadUnpacked command (branded Chrome no longer accepts --load-extension).
 */
export async function launchWithExtension(userDataDir: string): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { id } = (await cdp.send('Extensions.loadUnpacked' as never, { path: EXTENSION_DIST } as never)) as { id: string };
  // Wait for the service worker to come up.
  for (let i = 0; i < 50; i++) {
    if (context.serviceWorkers().some((w) => w.url().startsWith(`chrome-extension://${id}/`))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { context, extensionId: id };
}

export function serviceWorker(context: BrowserContext, extensionId: string) {
  const sw = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${extensionId}/`));
  if (!sw) throw new Error('Extension service worker not found');
  return sw;
}

export function cleanup(...dirs: string[]) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

export function pdfBytes(marker: string) {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}
