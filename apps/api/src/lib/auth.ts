import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PairingInfo } from '@appfolio/shared';
import type { Config } from '../config.js';
import { AppError } from './errors.js';
import { newId, nowIso, sha256 } from './util.js';

interface StoredPairing extends PairingInfo {
  tokenHash: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;

/**
 * Pairing secrets live in <dataDir>/auth.json (mode 0600), separate from the database,
 * so they're never included in backups or replaced by a restore. Only SHA-256 hashes of
 * tokens are stored.
 */
export class PairingStore {
  private file: string;
  private pairings: StoredPairing[] = [];
  private pending: { codeHash: string; expiresAt: number; attempts: number } | null = null;
  private lastSeenWrite = 0;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'auth.json');
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as { pairings?: StoredPairing[] };
      this.pairings = Array.isArray(data.pairings) ? data.pairings : [];
    } catch {
      this.pairings = [];
    }
  }

  private async save() {
    const tmp = this.file + '.tmp';
    await writeFile(tmp, JSON.stringify({ pairings: this.pairings }, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  list(): PairingInfo[] {
    return this.pairings.map(({ tokenHash: _t, ...p }) => p);
  }

  /** Create a short one-time code shown in the dashboard. Replaces any previous code. */
  createCode(): { code: string; expiresAt: string } {
    let raw = '';
    for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const expiresAt = Date.now() + CODE_TTL_MS;
    this.pending = { codeHash: sha256(raw), expiresAt, attempts: 0 };
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Exchange a valid code for a token bound to the calling extension's origin. */
  async redeem(code: string, origin: string, name: string | null): Promise<string> {
    const p = this.pending;
    if (!p || Date.now() > p.expiresAt) throw new AppError(400, 'pairing_code_invalid', 'This pairing code has expired. Generate a new one in the dashboard.');
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const a = Buffer.from(sha256(normalized), 'hex');
    const b = Buffer.from(p.codeHash, 'hex');
    if (!timingSafeEqual(a, b)) {
      p.attempts++;
      if (p.attempts >= MAX_CODE_ATTEMPTS) this.pending = null;
      throw new AppError(400, 'pairing_code_invalid', 'That pairing code is not correct.');
    }
    this.pending = null;
    const token = randomBytes(32).toString('base64url');
    // One pairing per extension origin: re-pairing the same extension replaces its old token.
    this.pairings = this.pairings.filter((x) => x.origin !== origin);
    this.pairings.push({ id: newId(), origin, name, tokenHash: sha256(token), createdAt: nowIso(), lastSeenAt: null, lastReminderSyncAt: null });
    await this.save();
    return token;
  }

  verify(token: string): StoredPairing | null {
    const h = Buffer.from(sha256(token), 'hex');
    for (const p of this.pairings) {
      if (timingSafeEqual(h, Buffer.from(p.tokenHash, 'hex'))) return p;
    }
    return null;
  }

  async touch(p: StoredPairing, opts: { reminderSync?: boolean } = {}) {
    p.lastSeenAt = nowIso();
    if (opts.reminderSync) p.lastReminderSyncAt = p.lastSeenAt;
    // Avoid rewriting the file on every request.
    if (opts.reminderSync || Date.now() - this.lastSeenWrite > 60_000) {
      this.lastSeenWrite = Date.now();
      await this.save();
    }
  }

  async revoke(id: string | 'all') {
    this.pairings = id === 'all' ? [] : this.pairings.filter((p) => p.id !== id);
    this.pending = null;
    await this.save();
  }
}

/** Routes an extension token may call. Everything else (documents, backup, deletes) is dashboard-only. */
const EXTENSION_ROUTES: Array<[string, RegExp]> = [
  ['GET', /^\/api\/health$/],
  ['GET', /^\/api\/session$/],
  ['POST', /^\/api\/captures$/],
  ['POST', /^\/api\/match$/],
  ['GET', /^\/api\/applications(\?.*)?$/],
  ['GET', /^\/api\/reminders\/schedule$/],
  ['POST', /^\/api\/extension\/heartbeat$/],
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type ClientKind = { kind: 'dashboard' } | { kind: 'extension'; pairing: StoredPairing } | { kind: 'pairing' } | { kind: 'public' };

declare module 'fastify' {
  interface FastifyRequest {
    client: ClientKind;
  }
}

export function allowedHosts(config: Config): Set<string> {
  return new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
}

export function dashboardOrigins(config: Config): Set<string> {
  return new Set([`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, ...config.devOrigins]);
}

/**
 * Request guard. CORS isn't relied on: every request must have a loopback Host header
 * (this blocks DNS rebinding), and then either
 *  - a valid extension bearer token whose bound origin matches the request Origin, limited to a few routes;
 *  - or a same-origin dashboard request (fetch metadata + Origin allowlist + custom header for writes).
 */
export function makeGuard(config: Config, pairings: PairingStore) {
  const hosts = allowedHosts(config);
  const origins = dashboardOrigins(config);
  return async function guard(req: FastifyRequest, reply: FastifyReply) {
    const host = String(req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) {
      throw new AppError(421, 'bad_host', 'Requests must be addressed to 127.0.0.1 or localhost.');
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    const path = req.url.split('?')[0];
    const origin = req.headers.origin ? String(req.headers.origin) : null;
    const fetchSite = req.headers['sec-fetch-site'] ? String(req.headers['sec-fetch-site']) : null;
    const auth = req.headers.authorization;

    if (!path.startsWith('/api/')) {
      // Static dashboard files: refuse to be embedded or fetched by other sites.
      if (fetchSite === 'cross-site' && req.headers['sec-fetch-mode'] !== 'navigate') throw new AppError(403, 'forbidden', 'Cross-site request refused');
      req.client = { kind: 'public' };
      return;
    }

    if (auth?.startsWith('Bearer ')) {
      const pairing = pairings.verify(auth.slice(7).trim());
      if (!pairing) throw new AppError(401, 'unpaired', 'This extension is not paired (or its pairing was reset). Pair it again from the dashboard.');
      if (origin && origin !== pairing.origin) throw new AppError(401, 'origin_mismatch', 'Token was issued to a different extension.');
      const allowed = EXTENSION_ROUTES.some(([m, re]) => m === req.method && re.test(req.url));
      if (!allowed) throw new AppError(403, 'forbidden', 'The extension is not allowed to call this endpoint.');
      req.client = { kind: 'extension', pairing };
      await pairings.touch(pairing);
      return;
    }

    if (path === '/api/health' && req.method === 'GET') {
      req.client = { kind: 'public' };
      return;
    }

    if (path === '/api/pair' && req.method === 'POST') {
      if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
        throw new AppError(403, 'forbidden', 'Pairing must come from the Appfolio browser extension.');
      }
      req.client = { kind: 'pairing' };
      return;
    }

    // Dashboard.
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      throw new AppError(403, 'forbidden', 'Cross-site request refused');
    }
    if (origin && !origins.has(origin)) throw new AppError(403, 'forbidden', 'Origin not allowed');
    if (!SAFE_METHODS.has(req.method)) {
      if (!origin) throw new AppError(403, 'forbidden', 'Missing Origin header');
      if (req.headers['x-appfolio-client'] !== 'dashboard') throw new AppError(403, 'forbidden', 'Missing client header');
    }
    req.client = { kind: 'dashboard' };
  };
}
