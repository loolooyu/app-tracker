import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JD_TEXT, captureNew, cleanup, startServer, type TestServer } from './helpers.js';

let s: TestServer;
beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  await s.dispose();
  cleanup(s.dataDir);
});

describe('capture and status', () => {
  it('a captured job is Saved, not Applied, and does not count as an application', async () => {
    const r = await s.req('POST', '/api/captures', captureNew());
    expect(r.status).toBe(201);
    expect(r.body.outcomes).toEqual(['created', 'snapshot_added']);
    const app = (await s.req('GET', `/api/applications/${r.body.applicationId}`)).body;
    expect(app.status).toBe('saved');
    expect(app.submittedAt).toBeNull();
    expect(app.resumeNeeded).toBe(false);
    expect(app.primarySnapshot.reviewedText).toBe(JD_TEXT);
    const sum = (await s.req('GET', '/api/summary')).body;
    expect(sum).toMatchObject({ applications: 0, jdsPreserved: 1 });
    // Reading the record (e.g. to open its posting) changes nothing.
    const again = (await s.req('GET', `/api/applications/${r.body.applicationId}`)).body;
    expect(again.status).toBe('saved');
    expect(again.updatedAt).toBe(app.updatedAt);
  });

  it('requires review confirmation before a JD is committed', async () => {
    const body = captureNew();
    (body.snapshot as Record<string, unknown>).reviewConfirmed = false;
    const r = await s.req('POST', '/api/captures', body);
    expect(r.status).toBe(400);
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(0);
  });

  it('retrying the same capture ID is idempotent', async () => {
    const body = captureNew();
    const first = await s.req('POST', '/api/captures', body);
    const second = await s.req('POST', '/api/captures', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.applicationId).toBe(first.body.applicationId);
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(1);
  });

  it('NUworks discovery + Workday destination keeps both routes on one record', async () => {
    const created = (await s.req('POST', '/api/captures', captureNew())).body;
    const linkUrl = 'https://northwind.wd1.myworkdayjobs.com/en-US/careers/job/Boston-MA/Software-Engineer-Co-op_R0099123/apply';
    const linked = await s.req('POST', '/api/captures', {
      mode: 'link',
      captureId: randomUUID(),
      applicationId: created.applicationId,
      link: { url: linkUrl, platform: 'workday', relationship: 'application' },
      snapshot: null,
      setAppliedThrough: true,
    });
    expect(linked.body.outcomes).toEqual(['linked']);
    const app = (await s.req('GET', `/api/applications/${created.applicationId}`)).body;
    expect(app.foundOn).toBe('nuworks');
    expect(app.appliedThrough).toBe('workday');
    expect(app.status).toBe('saved'); // opening/linking an application form never implies submission
    expect(app.links.map((l: { relationship: string; platform: string }) => [l.relationship, l.platform])).toEqual([
      ['discovery', 'nuworks'],
      ['application', 'workday'],
    ]);
    // Original URL is preserved; normalized URL drops tracking parameters only.
    expect(app.links[0].url).toContain('utm_source=email');
    expect(app.links[0].normalizedUrl).toBe('https://jobs.university.test/jobs/88213');
    // A form-only page adds no snapshot.
    expect(app.snapshots).toHaveLength(1);

    // Matching from the Workday page now finds the record by exact URL.
    const m = (await s.req('POST', '/api/match', { url: linkUrl + '?utm_medium=x', platform: 'workday' })).body;
    expect(m[0]).toMatchObject({ kind: 'exact_url' });
    expect(m[0].application.id).toBe(created.applicationId);
  });

  it('similar titles are suggested, never merged', async () => {
    const a = (await s.req('POST', '/api/captures', captureNew())).body;
    const b = (
      await s.req(
        'POST',
        '/api/captures',
        captureNew({
          application: { company: 'Northwind Robotics, Inc.', title: 'Robotics Software Engineer Co-op', location: 'Austin, TX', jobId: 'R2', foundOn: 'linkedin', tags: [] },
          link: { url: 'https://www.linkedin.com/jobs/view/3900000001/', platform: 'linkedin', relationship: 'discovery' },
        }),
      )
    ).body;
    expect(a.applicationId).not.toBe(b.applicationId);
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(2);
    const m = (await s.req('POST', '/api/match', { company: 'Northwind Robotics', title: 'Robotics Software Engineer Co-op', location: 'Boston, MA' })).body;
    expect(m.every((c: { kind: string }) => c.kind === 'similar')).toBe(true);
    expect(m).toHaveLength(2);
    expect(m[0].application.id).toBe(a.applicationId); // same location ranks first
    expect(m[1].reasons).toContain('Different location');
  });
});

describe('JD snapshots', () => {
  it('are immutable; recapture adds a dated snapshot and identical text is reused', async () => {
    const raw = JD_TEXT + '\n\nSimilar jobs: Firmware Intern';
    const created = (await s.req('POST', '/api/captures', captureNew({ snapshot: { sourceUrl: null, rawText: raw, reviewedText: JD_TEXT, method: 'generic_dom', warnings: ['x'], reviewConfirmed: true } }))).body;
    const id = created.applicationId;
    const first = (await s.req('GET', `/api/snapshots/${created.snapshotId}`)).body;
    expect(first.rawText).toBe(raw);
    expect(first.reviewedText).toBe(JD_TEXT);
    expect(first.edited).toBe(true);

    expect(() => s.ctx.db.prepare('UPDATE jd_snapshots SET reviewed_text = ? WHERE id = ?').run('tampered', created.snapshotId)).toThrow(/immutable/);

    const second = await s.req('POST', `/api/applications/${id}/snapshots`, {
      snapshot: { sourceUrl: 'https://northwind.example/careers/1', rawText: 'Different JD from the company site. Responsibilities: X.', reviewedText: 'Different JD from the company site. Responsibilities: X.', method: 'adapter', warnings: [], reviewConfirmed: true },
    });
    expect(second.status).toBe(201);
    const same = await s.req('POST', `/api/applications/${id}/snapshots`, {
      snapshot: { sourceUrl: null, rawText: JD_TEXT, reviewedText: JD_TEXT + '\n', method: 'manual_paste', warnings: [], reviewConfirmed: true },
    });
    expect(same.status).toBe(200);
    expect(same.body).toEqual({ snapshotId: created.snapshotId, reused: true });

    const app = (await s.req('GET', `/api/applications/${id}`)).body;
    expect(app.snapshots).toHaveLength(2);
    expect(app.primarySnapshotId).toBe(created.snapshotId); // first stays primary unless chosen
    expect((await s.req('GET', `/api/snapshots/${created.snapshotId}`)).body.reviewedText).toBe(JD_TEXT);

    const switched = (await s.req('PATCH', `/api/applications/${id}`, { primarySnapshotId: second.body.snapshotId })).body;
    expect(switched.primarySnapshot.reviewedText).toContain('Different JD');
    expect(switched.activity.some((e: { type: string }) => e.type === 'primary_snapshot_changed')).toBe(true);
  });

  it('stores captured markup as inert text exactly as given', async () => {
    const hostile = 'Responsibilities <script>alert(1)</script> <img src=x onerror=alert(2)>';
    const r = (await s.req('POST', '/api/captures', captureNew({ snapshot: { sourceUrl: null, rawText: hostile, reviewedText: hostile, method: 'manual_paste', warnings: [], reviewConfirmed: true } }))).body;
    const snap = (await s.req('GET', `/api/snapshots/${r.snapshotId}`)).body;
    expect(snap.reviewedText).toBe(hostile);
    const dl = await s.req('GET', `/api/snapshots/${r.snapshotId}/download`);
    expect(String(dl.headers['content-type'])).toMatch(/^text\/plain/);
    expect(dl.raw.toString()).toContain(hostile);
  });

  it('is retrievable offline: the saved JD comes from storage, never the original URL', async () => {
    const r = (await s.req('POST', '/api/captures', captureNew({ link: { url: 'https://expired-posting.invalid/job/1', platform: 'company', relationship: 'discovery' } }))).body;
    const dl = await s.req('GET', `/api/snapshots/${r.snapshotId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.raw.toString()).toContain('quaternion calibration');
    expect(String(dl.headers['content-disposition'])).toContain('attachment');
  });
});

describe('search, filters and sorting', () => {
  it('finds terms that only appear in the saved JD and says so', async () => {
    const r = (await s.req('POST', '/api/captures', captureNew())).body;
    await s.req('POST', '/api/captures', captureNew({ application: { company: 'Harborview', title: 'Data Analyst', foundOn: 'handshake', tags: [] }, link: null, snapshot: null }));
    const res = (await s.req('GET', '/api/applications?q=quaternion')).body;
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(r.applicationId);
    expect(res[0].matchedIn).toContain('saved JD');
    expect(res[0].snippet).toMatch(/quaternion calibration/);
    expect((await s.req('GET', '/api/applications?q=%22motion-planning%20features%22')).body).toHaveLength(1);
    expect((await s.req('GET', '/api/applications?q=100%25')).body).toHaveLength(0); // LIKE wildcards are escaped
  });

  it('filters by platform across found-on, applied-through and links; sorts saved jobs predictably', async () => {
    const a = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    const b = (await s.req('POST', '/api/captures', captureNew({ application: { company: 'Acme', title: 'QA', foundOn: 'linkedin', tags: [] }, link: null }))).body.applicationId;
    const c = (await s.req('POST', '/api/captures', captureNew({ application: { company: 'Beta', title: 'SWE', foundOn: 'company', tags: [] }, link: null }))).body.applicationId;
    await s.req('POST', `/api/applications/${c}/links`, { url: 'https://x.wd1.myworkdayjobs.com/a/job/b_R1', platform: 'workday', relationship: 'application' });
    expect((await s.req('GET', '/api/applications?platform=workday')).body.map((x: { id: string }) => x.id)).toEqual([c]);
    expect((await s.req('GET', '/api/applications?platform=nuworks')).body.map((x: { id: string }) => x.id)).toEqual([a]);

    await s.req('POST', `/api/applications/${b}/mark-applied`, { submittedAt: '2026-09-01T12:00:00Z' });
    await s.req('POST', `/api/applications/${a}/mark-applied`, { submittedAt: '2026-09-05T12:00:00Z' });
    const order = (await s.req('GET', '/api/applications?sort=submitted')).body.map((x: { id: string }) => x.id);
    expect(order).toEqual([a, b, c]); // newest submission first; unsubmitted saved jobs last
    const missing = (await s.req('GET', '/api/applications?missingResume=1')).body.map((x: { id: string }) => x.id);
    expect(missing.sort()).toEqual([a, b].sort());
  });

  it('archiving hides a record from active views without deleting it', async () => {
    const a = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    await s.req('PATCH', `/api/applications/${a}`, { archived: true });
    expect((await s.req('GET', '/api/applications')).body).toHaveLength(0);
    expect((await s.req('GET', '/api/applications?archived=archived')).body).toHaveLength(1);
    expect((await s.req('GET', '/api/summary')).body.jdsPreserved).toBe(0);
    const app = (await s.req('GET', `/api/applications/${a}`)).body;
    expect(app.primarySnapshot.reviewedText).toBe(JD_TEXT);
  });
});

describe('status changes', () => {
  it('records corrections and outcomes in the activity history', async () => {
    const a = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    await s.req('POST', `/api/applications/${a}/mark-applied`, { submittedAt: '2026-09-05T12:00:00Z' });
    await s.req('PATCH', `/api/applications/${a}`, { submittedAt: '2026-09-04T09:00:00-04:00' });
    await s.req('POST', `/api/applications/${a}/status`, { status: 'rejected' });
    const app = (await s.req('GET', `/api/applications/${a}`)).body;
    expect(app.submittedAt).toBe('2026-09-04T13:00:00.000Z');
    expect(app.status).toBe('rejected');
    const types = app.activity.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'marked_applied', 'submitted_at_corrected', 'status_changed']));
    const corrected = app.activity.find((e: { type: string }) => e.type === 'submitted_at_corrected');
    expect(corrected.data).toEqual({ from: '2026-09-05T12:00:00.000Z', to: '2026-09-04T13:00:00.000Z' });
  });

  it('rejects unknown statuses', async () => {
    const a = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    expect((await s.req('POST', `/api/applications/${a}/status`, { status: 'hired' })).status).toBe(400);
  });
});
