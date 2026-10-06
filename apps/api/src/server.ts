import { existsSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import { openDatabase, type DB } from './db/index.js';
import { makeGuard, PairingStore } from './lib/auth.js';
import { DB_FILENAME, RestoreManager } from './lib/backup.js';
import { AppError } from './lib/errors.js';
import { FileStore } from './lib/files.js';
import { registerRoutes } from './routes.js';
import type { Ctx } from './store/core.js';

export interface AppServer {
  app: FastifyInstance;
  ctx: Ctx;
  pairings: PairingStore;
  close(): Promise<void>;
}

const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export async function buildServer(config: Config): Promise<AppServer> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700).catch(() => undefined);
  const files = new FileStore(config.dataDir);
  await files.init();
  const db = openDatabase(join(config.dataDir, DB_FILENAME));
  await chmod(join(config.dataDir, DB_FILENAME), 0o600).catch(() => undefined);
  const ctx: Ctx = { db, files, config };

  const keys = new Set((db.prepare('SELECT storage_key FROM documents').all() as Array<{ storage_key: string }>).map((r) => r.storage_key));
  const maintenance = await files.cleanup(keys);
  const storageReport = { documents: keys.size, missingFiles: maintenance.missing.length, orphanFilesRemoved: maintenance.orphansRemoved };

  const pairings = new PairingStore(config.dataDir);
  const restore = new RestoreManager(ctx);

  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            // Never log request bodies, headers or tokens; URLs and status codes only.
            serializers: {
              req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
    bodyLimit: 8 * 1024 * 1024,
    trustProxy: false,
  });

  app.decorateRequest('client', null as never);
  app.addHook('onRequest', makeGuard(config, pairings));
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4, parts: 6 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'bad_request', message: err.issues[0]?.message ?? 'Invalid request' } });
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ error: { code: 'file_too_large', message: `File exceeds the ${Math.round(config.maxUploadBytes / 1048576)} MB limit` } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err: { message: e.message, code: e.code } }, 'request failed');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on the local server. Check the terminal running Appfolio.' } });
  });

  registerRoutes(app, {
    ctx,
    pairings,
    restore,
    storageReport,
    reopen: (newDb: DB) => {
      ctx.db = newDb;
    },
  });

  if (config.webDist && existsSync(join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      index: ['index.html'],
      setHeaders(res, path) {
        if (path.endsWith('.html')) {
          res.header('Content-Security-Policy', DASHBOARD_CSP);
          res.header('Cache-Control', 'no-cache');
        }
        res.header('X-Frame-Options', 'SAMEORIGIN');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        reply.header('Content-Security-Policy', DASHBOARD_CSP);
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply
          .code(404)
          .type('text/plain')
          .send('The dashboard has not been built. Run `npm run build`, or use `npm run dev` and open http://localhost:5173.');
      }
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    });
  }

  return {
    app,
    ctx,
    pairings,
    async close() {
      await app.close();
      try {
        ctx.db.close();
      } catch {
        /* already closed */
      }
    },
  };
}
