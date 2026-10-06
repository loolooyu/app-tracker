import type { z } from 'zod';
import type {
  Assessment,
  ReminderSource,
  UpcomingAssessment,
  assessmentInputSchema,
  assessmentPatchSchema,
  interviewInputSchema,
  interviewPatchSchema,
} from '@appfolio/shared';
import { transaction } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { newId, nowIso, toUtcIso } from '../lib/util.js';
import { getApplicationRow } from './applications.js';
import { logActivity, mapAssessment, mapInterview, type Ctx } from './core.js';
import { getSettings } from './settings.js';

type Row = Record<string, unknown>;
type AssessmentInput = z.infer<typeof assessmentInputSchema>;
type AssessmentPatch = z.infer<typeof assessmentPatchSchema>;
type InterviewInput = z.infer<typeof interviewInputSchema>;
type InterviewPatch = z.infer<typeof interviewPatchSchema>;

function assessmentRow(ctx: Ctx, applicationId: string, id: string): Row {
  const r = ctx.db.prepare('SELECT * FROM assessments WHERE id = ? AND application_id = ?').get(id, applicationId) as Row | undefined;
  if (!r) throw notFound('Assessment');
  return r;
}

export function addAssessment(ctx: Ctx, applicationId: string, input: AssessmentInput): Assessment {
  return transaction(ctx.db, () => {
    getApplicationRow(ctx, applicationId);
    const id = newId();
    const at = nowIso();
    const offsets = input.reminderOffsetsMinutes ?? getSettings(ctx).defaultReminderOffsetsMinutes;
    ctx.db
      .prepare(
        'INSERT INTO assessments (id, application_id, type, title, url, due_at, timezone, completed_at, reminder_offsets, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
      )
      .run(id, applicationId, input.type, input.title, input.url, toUtcIso(input.dueAt), input.timezone, JSON.stringify(offsets), input.notes, at, at);
    logActivity(ctx, applicationId, 'assessment_added', { assessmentId: id, type: input.type, title: input.title, dueAt: toUtcIso(input.dueAt), timezone: input.timezone }, at);
    return mapAssessment(ctx.db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as Row);
  });
}

export function updateAssessment(ctx: Ctx, applicationId: string, id: string, patch: AssessmentPatch): Assessment {
  return transaction(ctx.db, () => {
    const row = assessmentRow(ctx, applicationId, id);
    const at = nowIso();
    const sets: string[] = [];
    const vals: Array<string | null> = [];
    const set = (col: string, v: string | null) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if (patch.type !== undefined) set('type', patch.type);
    if (patch.title !== undefined) set('title', patch.title);
    if (patch.url !== undefined) set('url', patch.url);
    if (patch.notes !== undefined) set('notes', patch.notes);
    if (patch.reminderOffsetsMinutes !== undefined) set('reminder_offsets', JSON.stringify(patch.reminderOffsetsMinutes));
    const newDue = patch.dueAt !== undefined ? toUtcIso(patch.dueAt) : (row.due_at as string | null);
    const newTz = patch.timezone ?? String(row.timezone);
    if (newDue !== row.due_at || newTz !== row.timezone) {
      set('due_at', newDue);
      set('timezone', newTz);
      logActivity(ctx, applicationId, 'assessment_rescheduled', { assessmentId: id, title: patch.title ?? row.title, from: row.due_at ?? null, to: newDue, timezone: newTz }, at);
    }
    if (patch.completed !== undefined) {
      const was = Boolean(row.completed_at);
      if (patch.completed !== was) {
        set('completed_at', patch.completed ? at : null);
        logActivity(ctx, applicationId, patch.completed ? 'assessment_completed' : 'assessment_reopened', { assessmentId: id, title: patch.title ?? row.title }, at);
      }
    }
    if (sets.length) {
      set('updated_at', at);
      ctx.db.prepare(`UPDATE assessments SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return mapAssessment(ctx.db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as Row);
  });
}

export function deleteAssessment(ctx: Ctx, applicationId: string, id: string) {
  transaction(ctx.db, () => {
    const row = assessmentRow(ctx, applicationId, id);
    ctx.db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
    logActivity(ctx, applicationId, 'assessment_removed', { assessmentId: id, title: row.title });
  });
}

export function upcomingAssessments(ctx: Ctx, opts: { includeCompleted?: boolean } = {}, now = new Date()): UpcomingAssessment[] {
  const rows = ctx.db
    .prepare(
      `SELECT x.*, a.company, a.title AS application_title FROM assessments x JOIN applications a ON a.id = x.application_id
       WHERE a.archived = 0 ${opts.includeCompleted ? '' : 'AND x.completed_at IS NULL'}
       ORDER BY x.completed_at IS NOT NULL, x.due_at IS NULL, x.due_at, x.created_at`,
    )
    .all() as Row[];
  return rows.map((r) => {
    const a = mapAssessment(r);
    return {
      ...a,
      company: String(r.company),
      applicationTitle: String(r.application_title),
      overdue: !a.completedAt && !!a.dueAt && new Date(a.dueAt).getTime() < now.getTime(),
    };
  });
}

/** Minimal metadata the extension caches to schedule notifications. No JD or document content. */
export function reminderSchedule(ctx: Ctx, now = new Date()): ReminderSource[] {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const rows = ctx.db
    .prepare(
      `SELECT x.id, x.application_id, x.title, x.due_at, x.timezone, x.reminder_offsets, x.completed_at, a.company FROM assessments x
       JOIN applications a ON a.id = x.application_id
       WHERE a.archived = 0 AND x.due_at IS NOT NULL AND x.due_at >= ? ORDER BY x.due_at`,
    )
    .all(since) as Row[];
  return rows.map((r) => ({
    assessmentId: String(r.id),
    applicationId: String(r.application_id),
    title: String(r.title),
    company: String(r.company),
    dueAt: String(r.due_at),
    timezone: String(r.timezone),
    offsetsMinutes: JSON.parse(String(r.reminder_offsets)) as number[],
    completed: Boolean(r.completed_at),
  }));
}

export function getAssessmentForIcs(ctx: Ctx, id: string) {
  const r = ctx.db
    .prepare('SELECT x.*, a.company, a.title AS application_title FROM assessments x JOIN applications a ON a.id = x.application_id WHERE x.id = ?')
    .get(id) as Row | undefined;
  if (!r) throw notFound('Assessment');
  return { ...mapAssessment(r), company: String(r.company), applicationTitle: String(r.application_title) };
}

// ---------- Interviews ----------

export function addInterview(ctx: Ctx, applicationId: string, input: InterviewInput) {
  return transaction(ctx.db, () => {
    getApplicationRow(ctx, applicationId);
    const id = newId();
    const at = nowIso();
    ctx.db
      .prepare('INSERT INTO interviews (id, application_id, title, starts_at, timezone, format, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, applicationId, input.title, toUtcIso(input.startsAt), input.timezone, input.format, input.notes, at, at);
    logActivity(ctx, applicationId, 'interview_added', { interviewId: id, format: input.format, startsAt: toUtcIso(input.startsAt) }, at);
    return mapInterview(ctx.db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as Row);
  });
}

export function updateInterview(ctx: Ctx, applicationId: string, id: string, patch: InterviewPatch) {
  return transaction(ctx.db, () => {
    const row = ctx.db.prepare('SELECT * FROM interviews WHERE id = ? AND application_id = ?').get(id, applicationId) as Row | undefined;
    if (!row) throw notFound('Interview');
    const next = {
      title: patch.title !== undefined ? patch.title : row.title,
      starts_at: patch.startsAt !== undefined ? toUtcIso(patch.startsAt) : row.starts_at,
      timezone: patch.timezone ?? row.timezone,
      format: patch.format ?? row.format,
      notes: patch.notes !== undefined ? patch.notes : row.notes,
    };
    ctx.db
      .prepare('UPDATE interviews SET title = ?, starts_at = ?, timezone = ?, format = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(next.title as string | null, next.starts_at as string | null, String(next.timezone), String(next.format), next.notes as string | null, nowIso(), id);
    logActivity(ctx, applicationId, 'interview_updated', { interviewId: id });
    return mapInterview(ctx.db.prepare('SELECT * FROM interviews WHERE id = ?').get(id) as Row);
  });
}

export function deleteInterview(ctx: Ctx, applicationId: string, id: string) {
  transaction(ctx.db, () => {
    const r = ctx.db.prepare('SELECT id FROM interviews WHERE id = ? AND application_id = ?').get(id, applicationId);
    if (!r) throw notFound('Interview');
    ctx.db.prepare('DELETE FROM interviews WHERE id = ?').run(id);
    logActivity(ctx, applicationId, 'interview_removed', { interviewId: id });
  });
}
