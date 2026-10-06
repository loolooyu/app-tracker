import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DASH, EXT_ORIGIN, PORT, captureNew, cleanup, startServer, type TestServer } from './helpers.js';

let s: TestServer;
beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  await s.dispose();
  cleanup(s.dataDir);
});

async function pair(origin = EXT_ORIGIN): Promise<string> {
  const { code } = (await s.req('POST', '/api/pairing/code')).body;
  const r = await s.req('POST', '/api/pair', { code, extensionName: 'Chrome' }, { origin, 'x-appfolio-client': '', 'sec-fetch-site': 'cross-site' });
  expect(r.status).toBe(200);
  return r.body.token;
}

const ext = (token: string, origin = EXT_ORIGIN) => ({ authorization: `Bearer ${token}`, origin, 'x-appfolio-client': '', 'sec-fetch-site': 'cross-site' });

describe('local API protection', () => {
  it('rejects requests addressed to a non-loopback Host (DNS rebinding)', async () => {
    const r = await s.req('GET', '/api/applications', undefined, { host: `evil.example:${PORT}` });
    expect(r.status).toBe(421);
    expect((await s.req('GET', '/api/applications', undefined, { host: '127.0.0.1:9999' })).status).toBe(421);
  });

  it('rejects cross-site browser requests and writes without dashboard headers', async () => {
    expect((await s.req('GET', '/api/applications', undefined, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403);
    expect((await s.req('POST', '/api/captures', captureNew(), { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await s.req('POST', '/api/captures', captureNew(), { origin: '' })).status).toBe(403);
    expect((await s.req('POST', '/api/captures', captureNew(), { 'x-appfolio-client': '' })).status).toBe(403);
    // A simple form post from another site (no custom header, foreign origin) cannot delete.
    const id = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    expect((await s.req('DELETE', `/api/applications/${id}`, undefined, { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await s.req('GET', `/api/applications/${id}`)).status).toBe(200);
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(1);
  });

  it('rejects an unknown or reset extension token', async () => {
    const r = await s.req('POST', '/api/captures', captureNew(), ext('not-a-real-token'));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('unpaired');
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(0);
  });

  it('pairs an extension once per code, binds the token to its origin, and limits its routes', async () => {
    const { code } = (await s.req('POST', '/api/pairing/code')).body;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Pairing must come from an extension origin.
    expect((await s.req('POST', '/api/pair', { code }, { origin: 'https://evil.example' })).status).toBe(403);
    const ok = await s.req('POST', '/api/pair', { code: code.toLowerCase() }, { origin: EXT_ORIGIN, 'x-appfolio-client': '' });
    expect(ok.status).toBe(200);
    const token = ok.body.token as string;
    // The code is single-use.
    expect((await s.req('POST', '/api/pair', { code }, { origin: EXT_ORIGIN })).status).toBe(400);

    expect((await s.req('POST', '/api/captures', captureNew(), ext(token))).status).toBe(201);
    const list = await s.req('GET', '/api/applications?q=Northwind', undefined, ext(token));
    expect(list.status).toBe(200);
    const id = list.body[0].id;
    // Another extension can't use this token.
    expect((await s.req('GET', '/api/applications', undefined, ext(token, 'chrome-extension://pppppppppppppppppppppppppppppppp'))).status).toBe(401);
    // The extension can't delete, read documents, or take backups.
    expect((await s.req('DELETE', `/api/applications/${id}`, undefined, ext(token))).status).toBe(403);
    expect((await s.req('GET', '/api/documents', undefined, ext(token))).status).toBe(403);
    expect((await s.req('GET', '/api/export/backup', undefined, ext(token))).status).toBe(403);
    expect((await s.req('POST', '/api/pairing/code', undefined, ext(token))).status).toBe(403);
    expect((await s.req('GET', '/api/reminders/schedule', undefined, ext(token))).status).toBe(200);

    // The token is not stored in plain text, and the file is private.
    const authFile = join(s.dataDir, 'auth.json');
    expect(readFileSync(authFile, 'utf8')).not.toContain(token);
    expect(statSync(authFile).mode & 0o077).toBe(0);

    // Reset revokes it.
    const pairings = (await s.req('GET', '/api/pairings')).body;
    expect(pairings).toHaveLength(1);
    expect(pairings[0].origin).toBe(EXT_ORIGIN);
    expect((await s.req('DELETE', '/api/pairings/all')).status).toBe(204);
    expect((await s.req('POST', '/api/captures', captureNew(), ext(token))).status).toBe(401);
  });

  it('invalidates a pairing code after repeated wrong guesses', async () => {
    const { code } = (await s.req('POST', '/api/pairing/code')).body;
    for (let i = 0; i < 5; i++) expect((await s.req('POST', '/api/pair', { code: 'AAAA-AAAA' }, { origin: EXT_ORIGIN })).status).toBe(400);
    expect((await s.req('POST', '/api/pair', { code }, { origin: EXT_ORIGIN })).status).toBe(400);
  });

  it('pairing survives an API restart', async () => {
    const token = await pair();
    await s.dispose();
    s = await startServer(s.dataDir);
    expect((await s.req('GET', '/api/session', undefined, ext(token))).body.client).toBe('extension');
  });

  it('keeps the data directory private', async () => {
    expect(statSync(s.dataDir).mode & 0o077).toBe(0);
    expect(statSync(join(s.dataDir, 'documents')).mode & 0o077).toBe(0);
    expect(statSync(join(s.dataDir, 'appfolio.db')).mode & 0o077).toBe(0);
  });

  it('answers health without auth but nothing else', async () => {
    expect((await s.req('GET', '/api/health', undefined, { origin: EXT_ORIGIN, 'sec-fetch-site': 'cross-site' })).status).toBe(200);
    expect((await s.req('GET', '/api/summary', undefined, { origin: EXT_ORIGIN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  it('the dashboard headers used in tests are what a same-origin browser sends', () => {
    expect(DASH['sec-fetch-site']).toBe('same-origin');
  });
});
