import {
  JD_LIMITS,
  STATUSES,
  PLATFORMS,
  jobIdFromUrl,
  normalizeUrl,
  type ApplicationDetail,
  type ApplicationFields,
  type ApplicationPatch,
  type ApplicationSummary,
  type LinkInput,
  type Platform,
  type Snapshot,
  type SnapshotInput,
  type SourceLink,
  type Status,
  type Summary,
} from '@appfolio/shared';
import { transaction } from '../db/index.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { newId, nowIso, sha256, toUtcIso } from '../lib/util.js';
import {
  SNAPSHOT_SUMMARY_COLUMNS,
  SUMMARY_SELECT,
  logActivity,
  mapActivity,
  mapAssessment,
  mapDocument,
  mapInterview,
  mapLink,
  mapSnapshotSummary,
  mapSummaries,
  type Ctx,
} from './core.js';

type Row = Record<string, unknown>;

export function getApplicationRow(ctx: Ctx, id: string): Row {
  const row = ctx.db.prepare('SELECT * FROM applications WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw notFound('Application');
  return row;
}

export function createApplication(ctx: Ctx, f: ApplicationFields, opts: { status?: Status; isDemo?: boolean; at?: string } = {}): string {
  const id = newId();
  const at = opts.at ?? nowIso();
  ctx.db
    .prepare(
      `INSERT INTO applications (id, company, title, location, job_type, program, season, job_id, found_on, applied_through, status, notes, tags, archived, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(id, f.company, f.title, f.location, f.jobType, f.program, f.season, f.jobId, f.foundOn, f.appliedThrough, opts.status ?? 'saved', f.notes, JSON.stringify(f.tags ?? []), opts.isDemo ? 1 : 0, at, at);
  logActivity(ctx, id, 'created', { foundOn: f.foundOn }, at);
  return id;
}

export interface ListQuery {
  q?: string;
  platform?: Platform;
  status?: Status;
  missingResume?: boolean;
  assessmentDue?: boolean;
  archived?: 'active' | 'archived' | 'all';
  sort?: 'submitted' | 'updated' | 'company' | 'next_due';
}

function likeTerm(term: string) {
  return `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

/** Split a search string into terms; "quoted phrases" stay together. */
export function searchTerms(q: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) terms.push((m[1] ?? m[2]).trim());
  return terms.filter(Boolean).slice(0, 10);
}

export function listApplications(ctx: Ctx, query: ListQuery): ApplicationSummary[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  const archived = query.archived ?? 'active';
  if (archived === 'active') where.push('a.archived = 0');
  else if (archived === 'archived') where.push('a.archived = 1');
  if (query.status) {
    where.push('a.status = ?');
    params.push(query.status);
  }
  if (query.platform) {
    where.push('(a.found_on = ? OR a.applied_through = ? OR EXISTS (SELECT 1 FROM source_links l WHERE l.application_id = a.id AND l.platform = ?))');
    params.push(query.platform, query.platform, query.platform);
  }
  if (query.missingResume) {
    where.push(`a.submitted_resume_document_id IS NULL AND (a.submitted_at IS NOT NULL OR a.status IN ('applied','assessment','interview','offer'))`);
  }
  if (query.assessmentDue) {
    where.push('EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id AND x.completed_at IS NULL AND x.due_at IS NOT NULL)');
  }
  const terms = query.q ? searchTerms(query.q) : [];
  for (const term of terms) {
    const like = likeTerm(term);
    where.push(`(
      a.company LIKE ? ESCAPE '\\' OR a.title LIKE ? ESCAPE '\\' OR a.location LIKE ? ESCAPE '\\' OR a.notes LIKE ? ESCAPE '\\'
      OR a.tags LIKE ? ESCAPE '\\' OR a.job_id LIKE ? ESCAPE '\\' OR a.program LIKE ? ESCAPE '\\' OR a.season LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM jd_snapshots s WHERE s.application_id = a.id AND (s.reviewed_text LIKE ? ESCAPE '\\' OR s.raw_text LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM source_links l WHERE l.application_id = a.id AND l.url LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM assessments x WHERE x.application_id = a.id AND (x.title LIKE ? ESCAPE '\\' OR x.notes LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM interviews i WHERE i.application_id = a.id AND (i.title LIKE ? ESCAPE '\\' OR i.notes LIKE ? ESCAPE '\\'))
    )`);
    params.push(...Array(15).fill(like));
  }
  const order = {
    // Saved jobs (no submission date) sort after submitted ones, most recently updated first.
    submitted: 'a.submitted_at IS NULL, a.submitted_at DESC, a.updated_at DESC',
    updated: 'a.updated_at DESC',
    company: 'a.company COLLATE NOCASE ASC, a.title COLLATE NOCASE ASC, a.created_at DESC',
    next_due: 'next_due_at IS NULL, next_due_at ASC, a.updated_at DESC',
  }[query.sort ?? 'updated'];
  const sql = `SELECT * FROM (${SUMMARY_SELECT}) a ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}, a.id`;
  const rows = ctx.db.prepare(sql).all(...params) as Row[];
  const summaries = mapSummaries(ctx, rows);
  if (terms.length) annotateMatches(ctx, summaries, rows, terms);
  return summaries;
}

/** For search results, say where the terms matched and show a JD snippet when the JD was the reason. */
function annotateMatches(ctx: Ctx, summaries: ApplicationSummary[], rows: Row[], terms: string[]) {
  const lower = terms.map((t) => t.toLowerCase());
  summaries.forEach((sum, i) => {
    const r = rows[i];
    const matched = new Set<string>();
    let snippet: string | null = null;
    for (const t of lower) {
      const inMeta = [r.company, r.title, r.location, r.job_id, r.program, r.season, r.tags].some((v) => typeof v === 'string' && v.toLowerCase().includes(t));
      if (inMeta) matched.add('details');
      if (typeof r.notes === 'string' && r.notes.toLowerCase().includes(t)) matched.add('notes');
      if (inMeta) continue;
      const snap = ctx.db
        .prepare(
          `SELECT reviewed_text FROM jd_snapshots WHERE application_id = ? AND (reviewed_text LIKE ? ESCAPE '\\' OR raw_text LIKE ? ESCAPE '\\') ORDER BY (id = ?) DESC, captured_at DESC LIMIT 1`,
        )
        .get(sum.id, likeTerm(t), likeTerm(t), String(r.primary_snapshot_id ?? '')) as { reviewed_text: string } | undefined;
      if (snap) {
        matched.add('saved JD');
        if (!snippet) {
          const idx = snap.reviewed_text.toLowerCase().indexOf(t);
          if (idx >= 0) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(snap.reviewed_text.length, idx + t.length + 60);
            snippet = (start > 0 ? '…' : '') + snap.reviewed_text.slice(start, end).replace(/\s+/g, ' ') + (end < snap.reviewed_text.length ? '…' : '');
          }
        }
      }
    }
    if (!matched.size) matched.add('links or tasks');
    sum.matchedIn = [...matched];
    sum.snippet = snippet;
  });
}

export function getSummary(ctx: Ctx, now = new Date()): Summary {
  const one = (sql: string, ...p: Array<string | number>) => Number((ctx.db.prepare(sql).get(...p) as { n: number }).n);
  const nowIso = now.toISOString();
  return {
    applications: one('SELECT COUNT(*) AS n FROM applications WHERE archived = 0 AND submitted_at IS NOT NULL'),
    interviews: one(`SELECT COUNT(*) AS n FROM applications WHERE archived = 0 AND status = 'interview'`),
    assessmentsDue: one(
      `SELECT COUNT(*) AS n FROM assessments x JOIN applications a ON a.id = x.application_id WHERE a.archived = 0 AND x.completed_at IS NULL AND x.due_at IS NOT NULL AND x.due_at >= ?`,
      nowIso,
    ),
    assessmentsOverdue: one(
      `SELECT COUNT(*) AS n FROM assessments x JOIN applications a ON a.id = x.application_id WHERE a.archived = 0 AND x.completed_at IS NULL AND x.due_at IS NOT NULL AND x.due_at < ?`,
      nowIso,
    ),
    jdsPreserved: one('SELECT COUNT(*) AS n FROM applications a WHERE a.archived = 0 AND EXISTS (SELECT 1 FROM jd_snapshots s WHERE s.application_id = a.id)'),
    totalRecords: one('SELECT COUNT(*) AS n FROM applications'),
    hasDemoData: one('SELECT COUNT(*) AS n FROM applications WHERE is_demo = 1') + one('SELECT COUNT(*) AS n FROM documents WHERE is_demo = 1') > 0,
  };
}

function documentForApp(ctx: Ctx, id: unknown) {
  if (!id) return null;
  const r = ctx.db.prepare('SELECT * FROM documents WHERE id = ?').get(String(id)) as Row | undefined;
  return r ? mapDocument(r) : null;
}

export function getSnapshot(ctx: Ctx, id: string): Snapshot {
  const r = ctx.db.prepare(`SELECT ${SNAPSHOT_SUMMARY_COLUMNS}, raw_text, reviewed_text FROM jd_snapshots WHERE id = ?`).get(id) as Row | undefined;
  if (!r) throw notFound('Job description snapshot');
  return { ...mapSnapshotSummary(r), rawText: String(r.raw_text), reviewedText: String(r.reviewed_text) };
}

export function getApplication(ctx: Ctx, id: string): ApplicationDetail {
  const row = ctx.db.prepare(`SELECT * FROM (${SUMMARY_SELECT}) a WHERE a.id = ?`).get(id) as Row | undefined;
  if (!row) throw notFound('Application');
  const [summary] = mapSummaries(ctx, [row]);
  const links = (ctx.db.prepare('SELECT * FROM source_links WHERE application_id = ? ORDER BY added_at, id').all(id) as Row[]).map(mapLink);
  const snapshots = (ctx.db.prepare(`SELECT ${SNAPSHOT_SUMMARY_COLUMNS} FROM jd_snapshots WHERE application_id = ? ORDER BY captured_at, id`).all(id) as Row[]).map(
    mapSnapshotSummary,
  );
  const primaryId = row.primary_snapshot_id ? String(row.primary_snapshot_id) : null;
  return {
    ...summary,
    jobType: (row.job_type as string) ?? null,
    program: (row.program as string) ?? null,
    season: (row.season as string) ?? null,
    jobId: (row.job_id as string) ?? null,
    notes: (row.notes as string) ?? null,
    primarySnapshotId: primaryId,
    submittedResume: documentForApp(ctx, row.submitted_resume_document_id),
    submittedCoverLetter: documentForApp(ctx, row.submitted_cover_letter_document_id),
    links,
    snapshots,
    primarySnapshot: primaryId ? getSnapshot(ctx, primaryId) : null,
    assessments: (ctx.db.prepare('SELECT * FROM assessments WHERE application_id = ? ORDER BY due_at IS NULL, due_at, created_at').all(id) as Row[]).map(mapAssessment),
    interviews: (ctx.db.prepare('SELECT * FROM interviews WHERE application_id = ? ORDER BY starts_at IS NULL, starts_at, created_at').all(id) as Row[]).map(mapInterview),
    activity: (ctx.db.prepare('SELECT * FROM activity WHERE application_id = ? ORDER BY at DESC, rowid DESC').all(id) as Row[]).map(mapActivity),
  };
}

const FIELD_COLUMNS: Record<string, string> = {
  company: 'company',
  title: 'title',
  location: 'location',
  jobType: 'job_type',
  program: 'program',
  season: 'season',
  jobId: 'job_id',
  foundOn: 'found_on',
  appliedThrough: 'applied_through',
  notes: 'notes',
  tags: 'tags',
};

export function updateApplication(ctx: Ctx, id: string, patch: ApplicationPatch) {
  transaction(ctx.db, () => {
    const row = getApplicationRow(ctx, id);
    const changed: string[] = [];
    const platformChanges: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, col] of Object.entries(FIELD_COLUMNS)) {
      if (!(key in patch)) continue;
      const raw = (patch as Record<string, unknown>)[key];
      const value = key === 'tags' ? JSON.stringify(raw ?? []) : (raw ?? null);
      if (value === row[col]) continue;
      ctx.db.prepare(`UPDATE applications SET ${col} = ? WHERE id = ?`).run(value as string | null, id);
      if (key === 'notes') logActivity(ctx, id, 'notes_edited');
      else changed.push(key);
      if (key === 'foundOn' || key === 'appliedThrough') platformChanges[key] = { from: row[col], to: value };
    }
    if (changed.length) logActivity(ctx, id, 'details_edited', { fields: changed, ...platformChanges });

    if ('archived' in patch && Number(patch.archived) !== Number(row.archived)) {
      ctx.db.prepare('UPDATE applications SET archived = ? WHERE id = ?').run(patch.archived ? 1 : 0, id);
      logActivity(ctx, id, patch.archived ? 'archived' : 'unarchived');
    }
    if ('submittedAt' in patch) {
      const to = toUtcIso(patch.submittedAt);
      if (to !== row.submitted_at) {
        ctx.db.prepare('UPDATE applications SET submitted_at = ? WHERE id = ?').run(to, id);
        logActivity(ctx, id, 'submitted_at_corrected', { from: row.submitted_at ?? null, to });
      }
    }
    if ('primarySnapshotId' in patch && patch.primarySnapshotId !== row.primary_snapshot_id) {
      if (patch.primarySnapshotId) {
        const snap = ctx.db.prepare('SELECT application_id FROM jd_snapshots WHERE id = ?').get(patch.primarySnapshotId) as Row | undefined;
        if (!snap || snap.application_id !== id) throw badRequest('That snapshot does not belong to this application');
      }
      ctx.db.prepare('UPDATE applications SET primary_snapshot_id = ? WHERE id = ?').run(patch.primarySnapshotId ?? null, id);
      logActivity(ctx, id, 'primary_snapshot_changed', { from: row.primary_snapshot_id ?? null, to: patch.primarySnapshotId ?? null });
    }
  });
  return getApplication(ctx, id);
}

export function changeStatus(ctx: Ctx, id: string, status: Status, note: string | null) {
  if (!STATUSES.includes(status)) throw badRequest('Unknown status');
  transaction(ctx.db, () => {
    const row = getApplicationRow(ctx, id);
    if (row.status === status) return;
    ctx.db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
    logActivity(ctx, id, 'status_changed', { from: row.status, to: status, ...(note ? { note } : {}) });
  });
  return getApplication(ctx, id);
}

function assertDocument(ctx: Ctx, documentId: string, type: 'resume' | 'cover_letter') {
  const doc = ctx.db.prepare('SELECT type FROM documents WHERE id = ?').get(documentId) as Row | undefined;
  if (!doc) throw notFound(type === 'resume' ? 'Resume' : 'Cover letter');
  if (doc.type !== type) throw badRequest(`That document is a ${String(doc.type).replace('_', ' ')}, not a ${type.replace('_', ' ')}`);
}

export interface MarkAppliedInput {
  submittedAt: string;
  resumeDocumentId: string | null;
  coverLetterDocumentId: string | null;
  appliedThrough: Platform | null;
  note: string | null;
}

/** Record a submission. Status only advances from Saved; later stages are left alone. */
export function markApplied(ctx: Ctx, id: string, input: MarkAppliedInput) {
  transaction(ctx.db, () => {
    const row = getApplicationRow(ctx, id);
    if (input.resumeDocumentId) assertDocument(ctx, input.resumeDocumentId, 'resume');
    if (input.coverLetterDocumentId) assertDocument(ctx, input.coverLetterDocumentId, 'cover_letter');
    if (input.appliedThrough && !PLATFORMS.includes(input.appliedThrough)) throw badRequest('Unknown platform');
    const submittedAt = toUtcIso(input.submittedAt)!;
    const newStatus = row.status === 'saved' ? 'applied' : (row.status as string);
    ctx.db
      .prepare(
        `UPDATE applications SET status = ?, submitted_at = ?,
           submitted_resume_document_id = COALESCE(?, submitted_resume_document_id),
           submitted_cover_letter_document_id = COALESCE(?, submitted_cover_letter_document_id),
           applied_through = COALESCE(?, applied_through)
         WHERE id = ?`,
      )
      .run(newStatus, submittedAt, input.resumeDocumentId, input.coverLetterDocumentId, input.appliedThrough, id);
    logActivity(ctx, id, 'marked_applied', {
      submittedAt,
      resumeDocumentId: input.resumeDocumentId,
      coverLetterDocumentId: input.coverLetterDocumentId,
      ...(input.appliedThrough ? { appliedThrough: input.appliedThrough } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
    if (newStatus !== row.status) logActivity(ctx, id, 'status_changed', { from: row.status, to: newStatus });
    if (input.resumeDocumentId && row.submitted_resume_document_id && row.submitted_resume_document_id !== input.resumeDocumentId) {
      logActivity(ctx, id, 'resume_reassigned', { from: row.submitted_resume_document_id, to: input.resumeDocumentId });
    }
  });
  return getApplication(ctx, id);
}

/** Explicitly set or correct the submitted resume / cover letter. Always recorded. */
export function assignDocument(ctx: Ctx, id: string, kind: 'resume' | 'cover_letter', documentId: string | null, reason: string | null) {
  transaction(ctx.db, () => {
    const row = getApplicationRow(ctx, id);
    const col = kind === 'resume' ? 'submitted_resume_document_id' : 'submitted_cover_letter_document_id';
    const from = (row[col] as string | null) ?? null;
    if (from === documentId) return;
    if (documentId) assertDocument(ctx, documentId, kind);
    ctx.db.prepare(`UPDATE applications SET ${col} = ? WHERE id = ?`).run(documentId, id);
    const type = kind === 'resume' ? (from ? 'resume_reassigned' : 'resume_assigned') : from ? 'cover_letter_reassigned' : 'cover_letter_assigned';
    logActivity(ctx, id, documentId ? type : `${kind}_unlinked`, { from, to: documentId, ...(reason ? { reason } : {}) });
  });
  return getApplication(ctx, id);
}

export function deleteApplication(ctx: Ctx, id: string) {
  transaction(ctx.db, () => {
    getApplicationRow(ctx, id);
    ctx.db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  });
}

// ---------- Source links ----------

export function addLink(ctx: Ctx, applicationId: string, input: LinkInput): { link: SourceLink; existed: boolean } {
  return transaction(ctx.db, () => {
    getApplicationRow(ctx, applicationId);
    const normalized = normalizeUrl(input.url);
    const existing = ctx.db.prepare('SELECT * FROM source_links WHERE application_id = ? AND normalized_url = ?').get(applicationId, normalized) as Row | undefined;
    if (existing) return { link: mapLink(existing), existed: true };
    const id = newId();
    const at = nowIso();
    ctx.db
      .prepare('INSERT INTO source_links (id, application_id, url, normalized_url, platform, relationship, job_id, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, applicationId, input.url, normalized, input.platform, input.relationship, jobIdFromUrl(input.url, input.platform), at);
    logActivity(ctx, applicationId, 'link_added', { linkId: id, platform: input.platform, relationship: input.relationship, url: input.url }, at);
    return { link: mapLink(ctx.db.prepare('SELECT * FROM source_links WHERE id = ?').get(id) as Row), existed: false };
  });
}

export function deleteLink(ctx: Ctx, applicationId: string, linkId: string) {
  transaction(ctx.db, () => {
    const link = ctx.db.prepare('SELECT * FROM source_links WHERE id = ? AND application_id = ?').get(linkId, applicationId) as Row | undefined;
    if (!link) throw notFound('Link');
    ctx.db.prepare('DELETE FROM source_links WHERE id = ?').run(linkId);
    logActivity(ctx, applicationId, 'link_removed', { platform: link.platform, relationship: link.relationship, url: link.url });
  });
}

// ---------- JD snapshots ----------

export function snapshotHash(text: string) {
  return sha256(text.replace(/\r\n?/g, '\n').trim());
}

export interface AddSnapshotOptions {
  makePrimary?: boolean;
  allowDuplicate?: boolean;
  sourceLinkId?: string | null;
  captureId?: string | null;
  at?: string;
}

export function addSnapshot(ctx: Ctx, applicationId: string, input: SnapshotInput, opts: AddSnapshotOptions = {}): { snapshotId: string; reused: boolean } {
  return transaction(ctx.db, () => {
    const app = getApplicationRow(ctx, applicationId);
    const reviewed = input.reviewedText.replace(/\r\n?/g, '\n');
    if (reviewed.length > JD_LIMITS.maxChars) throw new AppError(413, 'jd_too_long', 'Job description is too long');
    const raw = input.rawText.trim() ? input.rawText.replace(/\r\n?/g, '\n') : reviewed;
    const hash = snapshotHash(reviewed);
    if (!opts.allowDuplicate) {
      const dup = ctx.db.prepare('SELECT id FROM jd_snapshots WHERE application_id = ? AND content_hash = ?').get(applicationId, hash) as Row | undefined;
      if (dup) {
        if (opts.makePrimary && app.primary_snapshot_id !== dup.id) {
          ctx.db.prepare('UPDATE applications SET primary_snapshot_id = ? WHERE id = ?').run(String(dup.id), applicationId);
          logActivity(ctx, applicationId, 'primary_snapshot_changed', { from: app.primary_snapshot_id ?? null, to: dup.id });
        }
        return { snapshotId: String(dup.id), reused: true };
      }
    }
    const id = newId();
    const at = opts.at ?? nowIso();
    ctx.db
      .prepare(
        `INSERT INTO jd_snapshots (id, application_id, source_link_id, source_url, captured_at, raw_text, reviewed_text, method, warnings, review_confirmed_at, content_hash, char_count, page_title, capture_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        applicationId,
        opts.sourceLinkId ?? null,
        input.sourceUrl,
        at,
        raw,
        reviewed,
        input.method,
        JSON.stringify(input.warnings ?? []),
        at,
        hash,
        reviewed.length,
        input.pageTitle,
        opts.captureId ?? null,
      );
    logActivity(ctx, applicationId, 'snapshot_added', { snapshotId: id, method: input.method, chars: reviewed.length, edited: raw !== reviewed, sourceUrl: input.sourceUrl }, at);
    if (!app.primary_snapshot_id || opts.makePrimary) {
      ctx.db.prepare('UPDATE applications SET primary_snapshot_id = ? WHERE id = ?').run(id, applicationId);
      if (app.primary_snapshot_id) logActivity(ctx, applicationId, 'primary_snapshot_changed', { from: app.primary_snapshot_id, to: id }, at);
    }
    return { snapshotId: id, reused: false };
  });
}
