import { describe, expect, it } from 'vitest';
import { planReminders, reconcileReminders, type ReminderSource } from '../src/reminders.js';

const H = 3600_000;
const base = (over: Partial<ReminderSource> = {}): ReminderSource => ({
  assessmentId: 'a1',
  applicationId: 'app1',
  title: 'HireVue',
  company: 'Northwind',
  dueAt: new Date(Date.UTC(2026, 9, 10, 12)).toISOString(),
  timezone: 'America/New_York',
  offsetsMinutes: [1440, 120],
  completed: false,
  ...over,
});

describe('reminder planning', () => {
  it('creates 24h and 2h reminders and none for completed tasks', () => {
    const plan = planReminders([base(), base({ assessmentId: 'a2', completed: true })]);
    expect(plan.map((p) => p.offsetMinutes)).toEqual([1440, 120]);
  });

  it('does not schedule reminders that were already past when the task was first seen', () => {
    const due = new Date(Date.UTC(2026, 9, 10, 12)).getTime();
    const now = due - 1 * H; // task added 1 hour before it is due
    const plan = planReminders([base()]);
    const r = reconcileReminders(plan, { delivered: new Set(), firstSeen: new Map() }, now);
    expect(r.schedule).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
    expect(r.skipped).toHaveLength(2);
  });

  it('reports only the latest missed reminder after the browser was closed', () => {
    const due = new Date(Date.UTC(2026, 9, 10, 12)).getTime();
    const firstSeen = new Map([[`a1|${due}`, due - 48 * H]]);
    const now = due - 1 * H; // both reminder times passed while closed
    const r = reconcileReminders(planReminders([base()]), { delivered: new Set(), firstSeen }, now);
    expect(r.missed.map((m) => m.offsetMinutes)).toEqual([120]);
    expect(r.schedule).toHaveLength(0);
  });

  it('rescheduling changes keys so old delivered reminders do not suppress new ones', () => {
    const before = planReminders([base()]);
    const after = planReminders([base({ dueAt: new Date(Date.UTC(2026, 9, 12, 12)).toISOString() })]);
    const delivered = new Set(before.map((p) => p.key));
    const now = Date.UTC(2026, 9, 9, 0);
    const firstSeen = new Map([[`a1|${Date.UTC(2026, 9, 12, 12)}`, now]]);
    const r = reconcileReminders(after, { delivered, firstSeen }, now);
    expect(r.schedule).toHaveLength(2);
  });

  it('never re-reports delivered reminders and ignores missed ones after the deadline', () => {
    const due = new Date(Date.UTC(2026, 9, 10, 12)).getTime();
    const plan = planReminders([base()]);
    const firstSeen = new Map([[`a1|${due}`, due - 72 * H]]);
    const r = reconcileReminders(plan, { delivered: new Set(), firstSeen }, due + H);
    expect(r.missed).toHaveLength(0);
    expect(r.schedule).toHaveLength(0);
  });
});
