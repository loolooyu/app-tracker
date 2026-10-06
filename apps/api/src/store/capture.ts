import {
  jobIdFromUrl,
  normalizeUrl,
  similarityScore,
  type CaptureInput,
  type CaptureOutcome,
  type CaptureResult,
  type MatchCandidate,
  type MatchQuery,
} from '@appfolio/shared';
import { transaction } from '../db/index.js';
import { nowIso } from '../lib/util.js';
import { addLink, addSnapshot, createApplication, getApplicationRow } from './applications.js';
import { SUMMARY_SELECT, logActivity, mapSummaries, type Ctx } from './core.js';

type Row = Record<string, unknown>;

/**
 * Apply a reviewed capture from the extension (or the dashboard's manual entry).
 * The whole capture is one transaction, and the capture ID makes it idempotent: a retry
 * after a timeout or a double click returns the original result without writing again.
 */
export function processCapture(ctx: Ctx, input: CaptureInput): CaptureResult {
  return transaction(ctx.db, () => {
    const prior = ctx.db.prepare('SELECT result FROM capture_requests WHERE capture_id = ?').get(input.captureId) as { result: string } | undefined;
    if (prior) return { ...(JSON.parse(prior.result) as CaptureResult), replayed: true };

    const outcomes: CaptureOutcome[] = [];
    let applicationId: string;
    let linkId: string | null = null;
    let snapshotId: string | null = null;

    if (input.mode === 'new') {
      applicationId = createApplication(ctx, input.application);
      outcomes.push('created');
      if (input.link) {
        const { link } = addLink(ctx, applicationId, input.link);
        linkId = link.id;
      }
      if (input.snapshot) {
        const r = addSnapshot(ctx, applicationId, input.snapshot, { sourceLinkId: linkId, captureId: input.captureId, makePrimary: true });
        snapshotId = r.snapshotId;
        outcomes.push('snapshot_added');
      }
    } else {
      applicationId = input.applicationId;
      const app = getApplicationRow(ctx, applicationId);
      const { link, existed } = addLink(ctx, applicationId, input.link);
      linkId = link.id;
      outcomes.push(existed ? 'link_exists' : 'linked');
      if (input.setAppliedThrough && app.applied_through !== input.link.platform) {
        ctx.db.prepare('UPDATE applications SET applied_through = ? WHERE id = ?').run(input.link.platform, applicationId);
        logActivity(ctx, applicationId, 'details_edited', { fields: ['appliedThrough'], appliedThrough: { from: app.applied_through ?? null, to: input.link.platform } });
      }
      if (input.snapshot) {
        const r = addSnapshot(ctx, applicationId, input.snapshot, { sourceLinkId: linkId, captureId: input.captureId, makePrimary: input.makePrimary });
        snapshotId = r.snapshotId;
        outcomes.push(r.reused ? 'snapshot_reused' : 'snapshot_added');
      }
    }

    const result: CaptureResult = { captureId: input.captureId, applicationId, outcomes, snapshotId, linkId, replayed: false };
    ctx.db.prepare('INSERT INTO capture_requests (capture_id, application_id, result, created_at) VALUES (?, ?, ?, ?)').run(input.captureId, applicationId, JSON.stringify(result), nowIso());
    return result;
  });
}

/**
 * Suggest existing applications for a page. Exact URL and job-ID matches come first;
 * similar company/title only ever produce suggestions, never merges.
 */
export function findMatches(ctx: Ctx, q: MatchQuery): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const seen = new Set<string>();
  const summaryById = (ids: string[]) => {
    if (!ids.length) return [];
    const rows = ctx.db.prepare(`SELECT * FROM (${SUMMARY_SELECT}) a WHERE a.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[];
    return mapSummaries(ctx, rows);
  };

  if (q.url) {
    const ids = (ctx.db.prepare('SELECT DISTINCT application_id FROM source_links WHERE normalized_url = ?').all(normalizeUrl(q.url)) as Row[]).map((r) => String(r.application_id));
    for (const app of summaryById(ids)) {
      seen.add(app.id);
      out.push({ application: app, kind: 'exact_url', score: 1, reasons: ['This exact page is already linked'] });
    }
  }

  const jobId = q.jobId?.trim() || (q.url && q.platform ? jobIdFromUrl(q.url, q.platform) : null);
  if (jobId) {
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT a.id, a.company FROM applications a LEFT JOIN source_links l ON l.application_id = a.id
         WHERE a.job_id = ? OR (l.job_id = ? AND l.platform = ?)`,
      )
      .all(jobId, jobId, q.platform ?? '') as Row[];
    const ids = rows
      .filter((r) => !seen.has(String(r.id)))
      // A bare job ID can collide across employers; require a plausible company when one is known.
      .filter((r) => !q.company || similarityScore({ company: q.company }, { company: String(r.company) }).reasons.some((x) => x.includes('company')))
      .map((r) => String(r.id));
    for (const app of summaryById(ids)) {
      seen.add(app.id);
      out.push({ application: app, kind: 'job_id', score: 0.95, reasons: [`Same job ID (${jobId})`] });
    }
  }

  if (q.company || q.title) {
    const rows = ctx.db.prepare(`SELECT * FROM (${SUMMARY_SELECT}) a WHERE a.archived = 0 ORDER BY a.updated_at DESC LIMIT 2000`).all() as Row[];
    const scored = mapSummaries(ctx, rows)
      .filter((a) => !seen.has(a.id))
      .map((a) => ({ a, s: similarityScore({ company: q.company, title: q.title, location: q.location }, a) }))
      .filter((x) => x.s.score >= 0.4 && x.s.reasons.some((r) => r.includes('company')))
      .sort((x, y) => y.s.score - x.s.score)
      .slice(0, 6);
    for (const { a, s } of scored) out.push({ application: a, kind: 'similar', score: Number(s.score.toFixed(2)), reasons: s.reasons });
  }
  return out;
}

