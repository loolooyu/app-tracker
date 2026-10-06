import type {
  ActivityEvent,
  ApplicationSummary,
  Assessment,
  DocumentRecord,
  Interview,
  Platform,
  SnapshotSummary,
  SourceLink,
  Status,
} from '@appfolio/shared';
import type { Config } from '../config.js';
import type { DB } from '../db/index.js';
import type { FileStore } from '../lib/files.js';
import { bool, json, newId, nowIso } from '../lib/util.js';

export interface Ctx {
  db: DB;
  files: FileStore;
  config: Config;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));

/** Record an activity event and bump the application's updated_at. Data holds references only, never document bytes or JD text. */
export function logActivity(ctx: Ctx, applicationId: string, type: string, data: Record<string, unknown> = {}, at = nowIso()) {
  ctx.db.prepare('INSERT INTO activity (id, application_id, type, at, data) VALUES (?, ?, ?, ?, ?)').run(newId(), applicationId, type, at, JSON.stringify(data));
  ctx.db.prepare('UPDATE applications SET updated_at = ? WHERE id = ?').run(at, applicationId);
}

export function mapLink(r: Row): SourceLink {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    url: String(r.url),
    normalizedUrl: String(r.normalized_url),
    platform: r.platform as Platform,
    relationship: r.relationship as SourceLink['relationship'],
    jobId: s(r.job_id),
    addedAt: String(r.added_at),
  };
}

export function mapSnapshotSummary(r: Row): SnapshotSummary {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    sourceLinkId: s(r.source_link_id),
    sourceUrl: s(r.source_url),
    capturedAt: String(r.captured_at),
    method: r.method as SnapshotSummary['method'],
    warnings: json<string[]>(r.warnings, []),
    reviewConfirmedAt: String(r.review_confirmed_at),
    contentHash: String(r.content_hash),
    charCount: Number(r.char_count),
    edited: Boolean(r.edited),
    pageTitle: s(r.page_title),
  };
}

export const SNAPSHOT_SUMMARY_COLUMNS =
  'id, application_id, source_link_id, source_url, captured_at, method, warnings, review_confirmed_at, content_hash, char_count, page_title, (raw_text <> reviewed_text) AS edited';

export function mapAssessment(r: Row): Assessment {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    type: r.type as Assessment['type'],
    title: String(r.title),
    url: s(r.url),
    dueAt: s(r.due_at),
    timezone: String(r.timezone),
    completedAt: s(r.completed_at),
    reminderOffsetsMinutes: json<number[]>(r.reminder_offsets, []),
    notes: s(r.notes),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function mapInterview(r: Row): Interview {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    title: s(r.title),
    startsAt: s(r.starts_at),
    timezone: String(r.timezone),
    format: r.format as Interview['format'],
    notes: s(r.notes),
    createdAt: String(r.created_at),
  };
}

export function mapActivity(r: Row): ActivityEvent {
  return {
    id: String(r.id),
    applicationId: String(r.application_id),
    type: String(r.type),
    at: String(r.at),
    data: json<Record<string, unknown>>(r.data, {}),
  };
}

export function mapDocument(r: Row, linked: DocumentRecord['linkedApplications'] = []): DocumentRecord {
  return {
    id: String(r.id),
    type: r.type as DocumentRecord['type'],
    label: String(r.label),
    originalFilename: String(r.original_filename),
    mimeType: String(r.mime_type),
    byteSize: Number(r.byte_size),
    contentHash: String(r.content_hash),
    createdAt: String(r.created_at),
    isDemo: bool(r.is_demo),
    linkedApplications: linked,
  };
}

/** Statuses that imply an application was submitted, used for the "Resume needed" flag. */
const SUBMITTED_STATUSES: Status[] = ['applied', 'assessment', 'interview', 'offer'];

export const SUMMARY_SELECT = `
SELECT a.*,
  EXISTS (SELECT 1 FROM jd_snapshots s WHERE s.application_id = a.id) AS has_snapshot,
  (SELECT x.id FROM assessments x WHERE x.application_id = a.id AND x.completed_at IS NULL AND x.due_at IS NOT NULL ORDER BY x.due_at LIMIT 1) AS next_assessment_id,
  (SELECT MIN(x.due_at) FROM assessments x WHERE x.application_id = a.id AND x.completed_at IS NULL AND x.due_at IS NOT NULL) AS next_due_at
FROM applications a`;

export function mapSummaries(ctx: Ctx, rows: Row[], now = Date.now()): ApplicationSummary[] {
  const nextIds = rows.map((r) => r.next_assessment_id).filter(Boolean) as string[];
  const next = new Map<string, Assessment>();
  if (nextIds.length) {
    const placeholders = nextIds.map(() => '?').join(',');
    for (const r of ctx.db.prepare(`SELECT * FROM assessments WHERE id IN (${placeholders})`).all(...nextIds) as Row[]) {
      next.set(String(r.id), mapAssessment(r));
    }
  }
  return rows.map((r) => {
    const status = r.status as Status;
    const submittedAt = s(r.submitted_at);
    const n = r.next_assessment_id ? next.get(String(r.next_assessment_id)) : undefined;
    return {
      id: String(r.id),
      company: String(r.company),
      title: String(r.title),
      location: s(r.location),
      status,
      foundOn: r.found_on as Platform,
      appliedThrough: (s(r.applied_through) as Platform | null) ?? null,
      submittedAt,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      archived: bool(r.archived),
      isDemo: bool(r.is_demo),
      tags: json<string[]>(r.tags, []),
      hasSnapshot: bool(r.has_snapshot),
      resumeNeeded: !r.submitted_resume_document_id && (Boolean(submittedAt) || SUBMITTED_STATUSES.includes(status)),
      nextAssessment: n && n.dueAt ? { id: n.id, title: n.title, dueAt: n.dueAt, timezone: n.timezone, overdue: new Date(n.dueAt).getTime() < now } : null,
    };
  });
}
