import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  APP_VERSION,
  addSnapshotSchema,
  applicationPatchSchema,
  assessmentInputSchema,
  assessmentPatchSchema,
  assignDocumentSchema,
  captureSchema,
  documentPatchSchema,
  documentTypeSchema,
  interviewInputSchema,
  interviewPatchSchema,
  isValidTimeZone,
  linkInputSchema,
  markAppliedSchema,
  matchQuerySchema,
  pairSchema,
  platformSchema,
  restoreApplySchema,
  settingsPatchSchema,
  statusChangeSchema,
  statusSchema,
  type SystemStatus,
} from '@appfolio/shared';
import { CURRENT_SCHEMA_VERSION } from './db/migrations.js';
import type { DB } from './db/index.js';
import type { PairingStore } from './lib/auth.js';
import { createBackupZip, type RestoreManager } from './lib/backup.js';
import { AppError, badRequest } from './lib/errors.js';
import { applicationsCsv, assessmentIcs } from './lib/exports.js';
import {
  addLink,
  addSnapshot,
  assignDocument,
  changeStatus,
  deleteApplication,
  deleteLink,
  getApplication,
  getSnapshot,
  getSummary,
  listApplications,
  markApplied,
  updateApplication,
} from './store/applications.js';
import { findMatches, processCapture } from './store/capture.js';
import type { Ctx } from './store/core.js';
import { removeDemo, seedDemo } from './store/demo.js';
import { deleteDocument, getDocument, listDocuments, renameDocument, uploadDocument } from './store/documents.js';
import { getSettings, updateSettings } from './store/settings.js';
import {
  addAssessment,
  addInterview,
  deleteAssessment,
  deleteInterview,
  getAssessmentForIcs,
  reminderSchedule,
  updateAssessment,
  updateInterview,
  upcomingAssessments,
} from './store/tasks.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw badRequest(`${where}${first?.message ?? 'Invalid request'}`, r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

/** RFC 6266 Content-Disposition that preserves the original (possibly non-ASCII) filename. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const idParam = z.object({ id: z.string().min(1).max(64) });
const bool = z
  .enum(['1', '0', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

const listQuery = z.object({
  q: z.string().max(500).optional(),
  platform: platformSchema.optional(),
  status: statusSchema.optional(),
  missingResume: bool,
  assessmentDue: bool,
  archived: z.enum(['active', 'archived', 'all']).optional(),
  sort: z.enum(['submitted', 'updated', 'company', 'next_due']).optional(),
});

export interface RouteDeps {
  ctx: Ctx;
  pairings: PairingStore;
  restore: RestoreManager;
  storageReport: SystemStatus['storage'];
  reopen: (db: DB) => void;
}

function dashboardOnly(req: FastifyRequest) {
  if (req.client.kind !== 'dashboard') throw new AppError(403, 'forbidden', 'Dashboard only');
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { ctx, pairings, restore } = deps;
  const dashboardUrl = (id: string) => `http://127.0.0.1:${ctx.config.port}/#/applications/${id}`;

  // ---------- system ----------
  app.get('/api/health', async () => ({ ok: true, app: 'appfolio', version: APP_VERSION }));

  app.get('/api/session', async (req) => ({
    client: req.client.kind,
    pairing: req.client.kind === 'extension' ? { id: req.client.pairing.id, createdAt: req.client.pairing.createdAt } : null,
  }));

  app.get('/api/status', async (req): Promise<SystemStatus> => {
    dashboardOnly(req);
    const docs = Number((ctx.db.prepare('SELECT COUNT(*) AS n FROM documents').get() as { n: number }).n);
    return {
      version: APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      dataDir: ctx.config.dataDir,
      maxUploadBytes: ctx.config.maxUploadBytes,
      pairings: pairings.list(),
      storage: { ...deps.storageReport, documents: docs },
    };
  });

  app.get('/api/summary', async (req) => {
    dashboardOnly(req);
    return getSummary(ctx);
  });

  app.get('/api/settings', async () => getSettings(ctx));
  app.patch('/api/settings', async (req) => updateSettings(ctx, parse(settingsPatchSchema, req.body)));

  // ---------- applications ----------
  app.get('/api/applications', async (req) => listApplications(ctx, parse(listQuery, req.query)));
  app.get('/api/applications/:id', async (req) => getApplication(ctx, parse(idParam, req.params).id));
  app.patch('/api/applications/:id', async (req) => updateApplication(ctx, parse(idParam, req.params).id, parse(applicationPatchSchema, req.body)));
  app.delete('/api/applications/:id', async (req, reply) => {
    deleteApplication(ctx, parse(idParam, req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/applications/:id/status', async (req) => {
    const b = parse(statusChangeSchema, req.body);
    return changeStatus(ctx, parse(idParam, req.params).id, b.status, b.note);
  });
  app.post('/api/applications/:id/mark-applied', async (req) => markApplied(ctx, parse(idParam, req.params).id, parse(markAppliedSchema, req.body)));
  app.post('/api/applications/:id/documents', async (req) => {
    const b = parse(assignDocumentSchema, req.body);
    return assignDocument(ctx, parse(idParam, req.params).id, b.kind, b.documentId, b.reason);
  });
  app.post('/api/applications/:id/links', async (req, reply) => {
    const r = addLink(ctx, parse(idParam, req.params).id, parse(linkInputSchema, req.body));
    return reply.code(r.existed ? 200 : 201).send(r);
  });
  app.delete('/api/applications/:id/links/:linkId', async (req, reply) => {
    const p = parse(z.object({ id: z.string(), linkId: z.string() }), req.params);
    deleteLink(ctx, p.id, p.linkId);
    return reply.code(204).send();
  });
  app.post('/api/applications/:id/snapshots', async (req, reply) => {
    const b = parse(addSnapshotSchema, req.body);
    const r = addSnapshot(ctx, parse(idParam, req.params).id, b.snapshot, { makePrimary: b.makePrimary, allowDuplicate: b.allowDuplicate });
    return reply.code(r.reused ? 200 : 201).send(r);
  });
  app.get('/api/snapshots/:id', async (req) => getSnapshot(ctx, parse(idParam, req.params).id));
  app.get('/api/snapshots/:id/download', async (req, reply) => {
    const { version } = parse(z.object({ version: z.enum(['reviewed', 'raw']).default('reviewed') }), req.query);
    const s = getSnapshot(ctx, parse(idParam, req.params).id);
    const app_ = getApplication(ctx, s.applicationId);
    const name = `${app_.company} - ${app_.title} - JD ${s.capturedAt.slice(0, 10)}${version === 'raw' ? ' (original capture)' : ''}.txt`.replace(/[\\/:*?"<>|]/g, '-');
    const header = [
      `${app_.title} — ${app_.company}`,
      app_.location ? `Location: ${app_.location}` : null,
      `Saved: ${s.capturedAt}`,
      s.sourceUrl ? `Source: ${s.sourceUrl}` : null,
      `Capture method: ${s.method}`,
      '',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', contentDisposition('attachment', name));
    return header + (version === 'raw' ? s.rawText : s.reviewedText) + '\n';
  });

  // ---------- assessments & interviews ----------
  app.post('/api/applications/:id/assessments', async (req, reply) => reply.code(201).send(addAssessment(ctx, parse(idParam, req.params).id, parse(assessmentInputSchema, req.body))));
  app.patch('/api/applications/:id/assessments/:aid', async (req) => {
    const p = parse(z.object({ id: z.string(), aid: z.string() }), req.params);
    return updateAssessment(ctx, p.id, p.aid, parse(assessmentPatchSchema, req.body));
  });
  app.delete('/api/applications/:id/assessments/:aid', async (req, reply) => {
    const p = parse(z.object({ id: z.string(), aid: z.string() }), req.params);
    deleteAssessment(ctx, p.id, p.aid);
    return reply.code(204).send();
  });
  app.get('/api/assessments/upcoming', async (req) => upcomingAssessments(ctx, { includeCompleted: parse(z.object({ includeCompleted: bool }), req.query).includeCompleted }));
  app.get('/api/assessments/:id/ics', async (req, reply) => {
    const a = getAssessmentForIcs(ctx, parse(idParam, req.params).id);
    if (!a.dueAt) throw badRequest('This assessment has no due time to export');
    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    reply.header('Content-Disposition', contentDisposition('attachment', `${a.company} - ${a.title}.ics`.replace(/[\\/:*?"<>|]/g, '-')));
    return assessmentIcs({ ...a, dueAt: a.dueAt, dashboardUrl: dashboardUrl(a.applicationId) });
  });
  app.post('/api/applications/:id/interviews', async (req, reply) => reply.code(201).send(addInterview(ctx, parse(idParam, req.params).id, parse(interviewInputSchema, req.body))));
  app.patch('/api/applications/:id/interviews/:iid', async (req) => {
    const p = parse(z.object({ id: z.string(), iid: z.string() }), req.params);
    return updateInterview(ctx, p.id, p.iid, parse(interviewPatchSchema, req.body));
  });
  app.delete('/api/applications/:id/interviews/:iid', async (req, reply) => {
    const p = parse(z.object({ id: z.string(), iid: z.string() }), req.params);
    deleteInterview(ctx, p.id, p.iid);
    return reply.code(204).send();
  });

  // ---------- capture & matching (dashboard and extension) ----------
  app.post('/api/captures', async (req, reply) => {
    const r = processCapture(ctx, parse(captureSchema, req.body));
    return reply.code(r.replayed ? 200 : 201).send(r);
  });
  app.post('/api/match', async (req) => findMatches(ctx, parse(matchQuerySchema, req.body)));

  // ---------- documents ----------
  app.get('/api/documents', async (req) => {
    dashboardOnly(req);
    const q = parse(z.object({ q: z.string().max(200).optional(), type: documentTypeSchema.optional() }), req.query);
    return listDocuments(ctx, q.q, q.type);
  });
  app.post('/api/documents', async (req, reply) => {
    dashboardOnly(req);
    const file = await req.file({ limits: { fileSize: ctx.config.maxUploadBytes, files: 1, fields: 4 } });
    if (!file) throw badRequest('No file uploaded');
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const type = parse(documentTypeSchema, fields.type?.value ?? 'resume');
    const label = typeof fields.label?.value === 'string' ? fields.label.value : null;
    const r = await uploadDocument(ctx, file.file, { filename: file.filename, type, label });
    return reply.code(r.reused ? 200 : 201).send(r);
  });
  app.get('/api/documents/:id', async (req) => {
    dashboardOnly(req);
    const { storageKey: _k, ...doc } = getDocument(ctx, parse(idParam, req.params).id);
    return doc;
  });
  app.patch('/api/documents/:id', async (req) => {
    dashboardOnly(req);
    const { storageKey: _k, ...doc } = renameDocument(ctx, parse(idParam, req.params).id, parse(documentPatchSchema, req.body).label);
    return doc;
  });
  app.delete('/api/documents/:id', async (req, reply) => {
    dashboardOnly(req);
    await deleteDocument(ctx, parse(idParam, req.params).id);
    return reply.code(204).send();
  });
  app.get('/api/documents/:id/file', async (req, reply) => {
    dashboardOnly(req);
    const { disposition } = parse(z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') }), req.query);
    const doc = getDocument(ctx, parse(idParam, req.params).id);
    const path = ctx.files.pathFor(doc.storageKey);
    if (!(await ctx.files.exists(doc.storageKey))) throw new AppError(410, 'file_missing', 'The stored file is missing from the data directory. Restore it from a backup.');
    // Only PDFs are offered inline (for the browser's PDF viewer); everything else downloads.
    const kind = disposition === 'inline' && doc.mimeType === 'application/pdf' ? 'inline' : 'attachment';
    reply.header('Content-Type', doc.mimeType);
    reply.header('Content-Length', String(doc.byteSize));
    reply.header('Content-Disposition', contentDisposition(kind, doc.originalFilename));
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    return reply.send(createReadStream(path));
  });

  // ---------- pairing ----------
  app.post('/api/pairing/code', async (req) => {
    dashboardOnly(req);
    return pairings.createCode();
  });
  app.get('/api/pairings', async (req) => {
    dashboardOnly(req);
    return pairings.list();
  });
  app.delete('/api/pairings/:id', async (req, reply) => {
    dashboardOnly(req);
    await pairings.revoke(parse(idParam, req.params).id);
    return reply.code(204).send();
  });
  app.post('/api/pair', async (req) => {
    if (req.client.kind !== 'pairing') throw new AppError(403, 'forbidden', 'Pairing must come from the extension');
    const b = parse(pairSchema, req.body);
    const token = await pairings.redeem(b.code, String(req.headers.origin), b.extensionName);
    return { token, apiVersion: APP_VERSION };
  });
  app.get('/api/reminders/schedule', async (req) => {
    if (req.client.kind === 'extension') await pairings.touch(req.client.pairing, { reminderSync: true });
    return { generatedAt: new Date().toISOString(), items: reminderSchedule(ctx) };
  });
  app.post('/api/extension/heartbeat', async (req) => {
    if (req.client.kind !== 'extension') throw new AppError(403, 'forbidden', 'Extension only');
    const b = parse(z.object({ reminderSync: z.boolean().optional() }), req.body ?? {});
    await pairings.touch(req.client.pairing, { reminderSync: b.reminderSync });
    return { ok: true };
  });

  // ---------- export / backup / restore ----------
  app.get('/api/export/csv', async (req, reply) => {
    dashboardOnly(req);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', contentDisposition('attachment', `appfolio-overview-${new Date().toISOString().slice(0, 10)}.csv`));
    return applicationsCsv(ctx);
  });
  app.get('/api/export/backup', async (req, reply) => {
    dashboardOnly(req);
    const path = join(ctx.files.tmpDir, `download-${randomUUID()}.zip`);
    await createBackupZip(ctx, path);
    const stream = createReadStream(path);
    stream.on('close', () => void rm(path, { force: true }));
    reply.header('Content-Type', 'application/zip');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Disposition', contentDisposition('attachment', `appfolio-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.appfolio-backup.zip`));
    return reply.send(stream);
  });
  app.post('/api/restore/stage', async (req) => {
    dashboardOnly(req);
    const file = await req.file({ limits: { fileSize: ctx.config.maxRestoreBytes, files: 1, fields: 0 } });
    if (!file) throw badRequest('No backup file uploaded');
    return restore.stage(file.file);
  });
  app.post('/api/restore/apply', async (req) => {
    dashboardOnly(req);
    const b = parse(restoreApplySchema, req.body);
    return restore.apply(b.stagingId, b.mode, b.confirm, deps.reopen);
  });
  app.delete('/api/restore/:id', async (req, reply) => {
    dashboardOnly(req);
    await restore.discard(parse(idParam, req.params).id);
    return reply.code(204).send();
  });

  // ---------- demo data ----------
  app.post('/api/demo', async (req, reply) => {
    dashboardOnly(req);
    const { timezone } = parse(z.object({ timezone: z.string().refine(isValidTimeZone).default('America/New_York') }), req.body ?? {});
    await seedDemo(ctx, timezone);
    return reply.code(201).send(getSummary(ctx));
  });
  app.delete('/api/demo', async (req) => {
    dashboardOnly(req);
    await removeDemo(ctx);
    return getSummary(ctx);
  });
}

