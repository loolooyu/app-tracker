/** Pure reminder scheduling logic shared by the extension and tests. */

export interface ReminderSource {
  assessmentId: string;
  applicationId: string;
  title: string;
  company: string;
  dueAt: string; // ISO UTC
  timezone: string;
  offsetsMinutes: number[];
  completed: boolean;
}

export interface PlannedReminder {
  key: string;
  assessmentId: string;
  applicationId: string;
  offsetMinutes: number;
  fireAt: number; // epoch ms
  dueAt: string;
}

/** A stable key: changes when the due time or offset changes, so rescheduling produces new reminders. */
export function reminderKey(assessmentId: string, dueAt: string, offsetMinutes: number): string {
  return `rem|${assessmentId}|${new Date(dueAt).getTime()}|${offsetMinutes}`;
}

export function planReminders(sources: ReminderSource[]): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const s of sources) {
    if (s.completed || !s.dueAt) continue;
    const due = new Date(s.dueAt).getTime();
    if (!Number.isFinite(due)) continue;
    for (const offset of [...new Set(s.offsetsMinutes)]) {
      out.push({
        key: reminderKey(s.assessmentId, s.dueAt, offset),
        assessmentId: s.assessmentId,
        applicationId: s.applicationId,
        offsetMinutes: offset,
        fireAt: due - offset * 60_000,
        dueAt: s.dueAt,
      });
    }
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

export interface ReconcileState {
  /** Keys already shown (or deliberately skipped). */
  delivered: Set<string>;
  /** When each assessment+due combination was first seen by this browser (epoch ms). */
  firstSeen: Map<string, number>;
}

export interface ReconcileResult {
  /** Future reminders that should have an alarm. */
  schedule: PlannedReminder[];
  /** Reminders whose time passed while the browser was closed/asleep, still relevant (assessment not yet due). */
  missed: PlannedReminder[];
  /** Reminders that were already in the past when the assessment was first seen: never shown. */
  skipped: PlannedReminder[];
}

/**
 * Decide what to schedule, what to surface as missed, and what to skip.
 * - A reminder whose fire time was already past when the task was first seen is skipped
 *   (adding a task due in 1 hour must not produce a "24 hours before" notification).
 * - Missed reminders are only reported if the deadline itself hasn't passed, and only the
 *   most recent missed reminder per assessment (no floods).
 */
export function reconcileReminders(plan: PlannedReminder[], state: ReconcileState, now: number): ReconcileResult {
  const schedule: PlannedReminder[] = [];
  const missedByAssessment = new Map<string, PlannedReminder>();
  const skipped: PlannedReminder[] = [];
  for (const r of plan) {
    if (state.delivered.has(r.key)) continue;
    const seenKey = `${r.assessmentId}|${new Date(r.dueAt).getTime()}`;
    const firstSeen = state.firstSeen.get(seenKey) ?? now;
    if (r.fireAt > now) {
      schedule.push(r);
    } else if (r.fireAt <= firstSeen) {
      skipped.push(r);
    } else if (new Date(r.dueAt).getTime() > now) {
      const prev = missedByAssessment.get(r.assessmentId);
      if (prev) skipped.push(prev.fireAt < r.fireAt ? prev : r);
      if (!prev || prev.fireAt < r.fireAt) missedByAssessment.set(r.assessmentId, r);
    } else {
      skipped.push(r);
    }
  }
  return { schedule, missed: [...missedByAssessment.values()], skipped };
}

export function describeOffset(minutes: number): string {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d === 1 ? '' : 's'} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? '' : 's'} before`;
  }
  return `${minutes} minutes before`;
}
