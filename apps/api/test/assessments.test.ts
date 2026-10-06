import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDateAndTime, zonedWallTimeToUtc } from '@appfolio/shared';
import { captureNew, cleanup, startServer, type TestServer } from './helpers.js';

let s: TestServer;
let appId: string;
beforeEach(async () => {
  s = await startServer();
  appId = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
});
afterEach(async () => {
  await s.dispose();
  cleanup(s.dataDir);
});

const dueIn = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();

describe('assessments', () => {
  it('stores the UTC instant plus the entered zone, and supports several per application', async () => {
    const wall = parseDateAndTime('2026-11-01', '23:59')!; // day DST ends in the US
    const dueAt = zonedWallTimeToUtc(wall, 'America/Los_Angeles').instant.toISOString();
    const a = await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'hirevue', title: 'HireVue', dueAt, timezone: 'America/Los_Angeles' });
    expect(a.status).toBe(201);
    expect(a.body.dueAt).toBe('2026-11-02T07:59:00.000Z'); // PST (UTC-8) after the change
    expect(a.body.reminderOffsetsMinutes).toEqual([1440, 120]);
    await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'oa', title: 'Codility OA', dueAt: dueIn(50), timezone: 'America/New_York', reminderOffsetsMinutes: [60] });
    const app = (await s.req('GET', `/api/applications/${appId}`)).body;
    expect(app.assessments).toHaveLength(2);
    expect(app.nextAssessment.title).toBe('Codility OA');
  });

  it('rejects unknown time zones and non-http links', async () => {
    expect((await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'oa', title: 'x', dueAt: dueIn(1), timezone: 'Nowhere/City' })).status).toBe(400);
    expect((await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'oa', title: 'x', dueAt: dueIn(1), timezone: 'UTC', url: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('upcoming/overdue lists and summary; completion removes it and stops reminders', async () => {
    const overdue = (await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'oa', title: 'Late OA', dueAt: dueIn(-2), timezone: 'UTC' })).body;
    const soon = (await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'hirevue', title: 'HireVue', dueAt: dueIn(5), timezone: 'UTC' })).body;
    let sum = (await s.req('GET', '/api/summary')).body;
    expect(sum).toMatchObject({ assessmentsDue: 1, assessmentsOverdue: 1 });
    const upcoming = (await s.req('GET', '/api/assessments/upcoming')).body;
    expect(upcoming.map((x: { title: string; overdue: boolean }) => [x.title, x.overdue])).toEqual([
      ['Late OA', true],
      ['HireVue', false],
    ]);

    await s.req('PATCH', `/api/applications/${appId}/assessments/${soon.id}`, { completed: true });
    sum = (await s.req('GET', '/api/summary')).body;
    expect(sum).toMatchObject({ assessmentsDue: 0, assessmentsOverdue: 1 });
    const sched = (await s.req('GET', '/api/reminders/schedule')).body.items;
    expect(sched.find((x: { assessmentId: string }) => x.assessmentId === soon.id).completed).toBe(true);
    expect((await s.req('GET', '/api/assessments/upcoming')).body.map((x: { id: string }) => x.id)).toEqual([overdue.id]);

    await s.req('PATCH', `/api/applications/${appId}/assessments/${soon.id}`, { completed: false });
    expect((await s.req('GET', '/api/summary')).body.assessmentsDue).toBe(1);
  });

  it('rescheduling updates the due time and is recorded', async () => {
    const a = (await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'oa', title: 'OA', dueAt: dueIn(10), timezone: 'UTC' })).body;
    const newDue = dueIn(30);
    const r = (await s.req('PATCH', `/api/applications/${appId}/assessments/${a.id}`, { dueAt: newDue, timezone: 'Asia/Shanghai' })).body;
    expect(r.dueAt).toBe(newDue);
    expect(r.timezone).toBe('Asia/Shanghai');
    const app = (await s.req('GET', `/api/applications/${appId}`)).body;
    const ev = app.activity.find((e: { type: string }) => e.type === 'assessment_rescheduled');
    expect(ev.data).toMatchObject({ from: a.dueAt, to: newDue, timezone: 'Asia/Shanghai' });
  });

  it('exports an ICS event with alarms', async () => {
    const a = (await s.req('POST', `/api/applications/${appId}/assessments`, { type: 'hirevue', title: 'HireVue, round 1', dueAt: '2026-12-01T17:00:00Z', timezone: 'America/New_York' })).body;
    const ics = await s.req('GET', `/api/assessments/${a.id}/ics`);
    expect(String(ics.headers['content-type'])).toMatch(/text\/calendar/);
    const text = ics.raw.toString();
    expect(text).toContain('DTEND:20261201T170000Z');
    expect(text).toContain('SUMMARY:Due: HireVue\\, round 1 — Northwind Robotics');
    expect(text).toContain('TRIGGER;RELATED=END:-PT1440M');
    expect(text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe('interviews', () => {
  it('can be added, edited and listed in the packet', async () => {
    const i = (await s.req('POST', `/api/applications/${appId}/interviews`, { title: 'Round 1', startsAt: '2026-10-20T14:00:00Z', timezone: 'America/New_York', format: 'video', notes: 'Bring questions' })).body;
    await s.req('PATCH', `/api/applications/${appId}/interviews/${i.id}`, { notes: 'Bring questions about ROS' });
    const app = (await s.req('GET', `/api/applications/${appId}`)).body;
    expect(app.interviews[0]).toMatchObject({ title: 'Round 1', format: 'video', notes: 'Bring questions about ROS' });
  });
});
