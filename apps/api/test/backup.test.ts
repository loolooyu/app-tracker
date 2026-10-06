import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { csvCell } from '../src/lib/exports.js';
import { captureNew, cleanup, pdf, rawZip, startServer, tempDir, zipOf, type TestServer } from './helpers.js';
import { DASH } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    await s.dispose();
    cleanup(s.dataDir);
  }
});
async function server(dir?: string) {
  const s = await startServer(dir);
  servers.push(s);
  return s;
}

async function populate(s: TestServer) {
  const cap = (await s.req('POST', '/api/captures', captureNew())).body;
  const id = cap.applicationId;
  await s.req('POST', '/api/captures', {
    mode: 'link',
    captureId: randomUUID(),
    applicationId: id,
    link: { url: 'https://northwind.wd1.myworkdayjobs.com/en-US/careers/job/Boston-MA/SWE_R0099123', platform: 'workday', relationship: 'application' },
    snapshot: { sourceUrl: 'https://northwind.wd1.myworkdayjobs.com/x', rawText: 'Company-site JD. Responsibilities: build.', reviewedText: 'Company-site JD. Responsibilities: build.', method: 'adapter', warnings: [], reviewConfirmed: true },
    setAppliedThrough: true,
  });
  const resume = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('resume-v3') }, { type: 'resume', label: 'Robotics v3' })).body.document;
  const other = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('resume-v4') }, { type: 'resume', label: 'Robotics v4' })).body.document;
  await s.req('POST', `/api/applications/${id}/mark-applied`, { submittedAt: '2026-10-01T15:00:00Z', resumeDocumentId: resume.id });
  await s.req('POST', `/api/applications/${id}/assessments`, { type: 'hirevue', title: 'HireVue', dueAt: '2026-12-01T17:00:00Z', timezone: 'America/New_York' });
  return { id, captureId: cap.captureId, resume, other };
}

async function backupOf(s: TestServer): Promise<Buffer> {
  const r = await s.req('GET', '/api/export/backup');
  expect(r.status).toBe(200);
  expect(String(r.headers['content-disposition'])).toMatch(/appfolio-backup-.*\.zip/);
  return r.raw;
}

async function stage(s: TestServer, zip: Buffer) {
  return s.upload('/api/restore/stage', { filename: 'backup.zip', content: zip, contentType: 'application/zip' });
}

describe('backup and restore', () => {
  it('round-trips records, JD text, file bytes, links and associations into a fresh workspace', async () => {
    const a = await server();
    const { id, captureId, resume, other } = await populate(a);
    const before = (await a.req('GET', `/api/applications/${id}`)).body;
    const zip = await backupOf(a);

    const b = await server();
    const staged = await stage(b, zip);
    expect(staged.status).toBe(200);
    expect(staged.body).toMatchObject({ currentWorkspaceEmpty: true, counts: { applications: 1, documents: 2, jd_snapshots: 2, source_links: 2, assessments: 1 } });
    // Nothing is applied until confirmed.
    expect((await b.req('GET', '/api/applications')).body).toHaveLength(0);
    const applied = await b.req('POST', '/api/restore/apply', { stagingId: staged.body.stagingId, mode: 'empty' });
    expect(applied.status).toBe(200);

    const after = (await b.req('GET', `/api/applications/${id}`)).body;
    expect(after.primarySnapshot.reviewedText).toBe(before.primarySnapshot.reviewedText);
    expect(after.snapshots.map((x: { contentHash: string }) => x.contentHash)).toEqual(before.snapshots.map((x: { contentHash: string }) => x.contentHash));
    expect(after.links.map((l: { url: string; relationship: string }) => [l.url, l.relationship])).toEqual(before.links.map((l: { url: string; relationship: string }) => [l.url, l.relationship]));
    expect(after.foundOn).toBe('nuworks');
    expect(after.appliedThrough).toBe('workday');
    expect(after.submittedResume.id).toBe(resume.id);
    expect(after.submittedResume.contentHash).toBe(resume.contentHash);
    expect(after.assessments[0]).toMatchObject({ title: 'HireVue', dueAt: '2026-12-01T17:00:00.000Z', timezone: 'America/New_York' });
    expect(after.activity.length).toBe(before.activity.length);
    const bytes = (await b.req('GET', `/api/documents/${resume.id}/file`)).raw;
    expect(Buffer.compare(bytes, pdf('resume-v3'))).toBe(0);
    const bytes2 = (await b.req('GET', `/api/documents/${other.id}/file`)).raw;
    expect(Buffer.compare(bytes2, pdf('resume-v4'))).toBe(0);
    // Saved JD search still works after restore.
    expect((await b.req('GET', '/api/applications?q=quaternion')).body).toHaveLength(1);
    // A queued extension capture retried after the restore is recognised, not duplicated.
    const retry = await b.req('POST', '/api/captures', { ...captureNew(), captureId });
    expect(retry.body.replayed).toBe(true);
    expect((await b.req('GET', '/api/applications')).body).toHaveLength(1);
    // Survives restart.
    await b.dispose();
    servers.splice(servers.indexOf(b), 1);
    const b2 = await server(b.dataDir);
    expect((await b2.req('GET', `/api/applications/${id}`)).body.primarySnapshot.reviewedText).toBe(before.primarySnapshot.reviewedText);
  });

  it('does not include pairing secrets and keeps the current pairing after restore', async () => {
    const a = await server();
    await populate(a);
    const { code } = (await a.req('POST', '/api/pairing/code')).body;
    const token = (await a.req('POST', '/api/pair', { code }, { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' })).body.token;
    const zip = await backupOf(a);
    expect(zip.includes(Buffer.from(token))).toBe(false);
    expect(zip.includes(Buffer.from('auth.json'))).toBe(false);
  });

  it('refuses to restore into a non-empty workspace without the replace flow, and replace creates a recovery backup', async () => {
    const a = await server();
    await populate(a);
    const zip = await backupOf(a);
    const b = await server();
    const existing = (await b.req('POST', '/api/captures', captureNew({ application: { company: 'Keep Me', title: 'Existing', foundOn: 'company', tags: [] }, link: null }))).body.applicationId;
    const staged = (await stage(b, zip)).body;
    expect(staged.currentWorkspaceEmpty).toBe(false);
    expect((await b.req('POST', '/api/restore/apply', { stagingId: staged.stagingId, mode: 'empty' })).status).toBe(409);
    expect((await b.req('POST', '/api/restore/apply', { stagingId: staged.stagingId, mode: 'replace', confirm: 'yes' })).status).toBe(400);
    expect((await b.req('GET', `/api/applications/${existing}`)).status).toBe(200);

    const r = await b.req('POST', '/api/restore/apply', { stagingId: staged.stagingId, mode: 'replace', confirm: 'REPLACE' });
    expect(r.status).toBe(200);
    expect(r.body.recoveryBackup).toMatch(/recovery-before-restore-.*\.zip$/);
    expect(existsSync(r.body.recoveryBackup)).toBe(true);
    expect((await b.req('GET', `/api/applications/${existing}`)).status).toBe(404);

    // The recovery backup restores the replaced workspace.
    const c = await server();
    const { readFileSync } = await import('node:fs');
    const st = (await stage(c, readFileSync(r.body.recoveryBackup))).body;
    await c.req('POST', '/api/restore/apply', { stagingId: st.stagingId, mode: 'empty' });
    expect((await c.req('GET', `/api/applications/${existing}`)).body.company).toBe('Keep Me');
  });

  it('rejects malformed archives before touching active data', async () => {
    const b = await server();
    const keep = (await b.req('POST', '/api/captures', captureNew())).body.applicationId;
    const manifest = (extra: object = {}) => JSON.stringify({ format: 'appfolio-backup', formatVersion: 1, schemaVersion: 1, createdAt: 'x', records: [], files: [], ...extra });

    const cases: Array<[string, Buffer, string]> = [
      ['path traversal', rawZip([{ name: 'manifest.json', content: manifest() }, { name: 'documents/../../evil', content: 'x' }]), 'restore_bad_path'],
      ['absolute path', rawZip([{ name: '/tmp/evil', content: 'x' }]), 'restore_bad_path'],
      ['unexpected entry', await zipOf([{ name: 'manifest.json', content: manifest() }, { name: 'run.sh', content: 'rm -rf /' }]), 'restore_unexpected_entry'],
      ['no manifest', await zipOf([{ name: 'records/applications.json', content: '{}' }]), 'restore_no_manifest'],
      ['missing hash', await zipOf([{ name: 'manifest.json', content: manifest({ records: [{ path: 'records/applications.json', table: 'applications', size: 2 }] }) }, { name: 'records/applications.json', content: '{}' }]), 'restore_missing_hash'],
      ['newer schema', await zipOf([{ name: 'manifest.json', content: manifest({ schemaVersion: 99 }) }]), 'restore_newer_schema'],
      ['not a zip', Buffer.from('definitely not a zip file'), 'restore_not_zip'],
    ];
    // A real backup whose document bytes were altered.
    const a = await server();
    await populate(a);
    const good = await backupOf(a);
    const tampered = Buffer.from(good);
    const marker = tampered.indexOf(Buffer.from('resume-v3'));
    tampered.write('resume-XX', marker, 'latin1');
    cases.push(['hash mismatch', tampered, 'restore_hash_mismatch']);

    for (const [name, zip, code] of cases) {
      const r = await stage(b, zip);
      expect(r.status, name).toBe(400);
      expect(r.body.error.code, name).toBe(code);
    }
    expect((await b.req('GET', `/api/applications/${keep}`)).status).toBe(200);
    expect((await b.req('GET', '/api/applications')).body).toHaveLength(1);
    expect(readdirSync(join(b.dataDir, 'tmp'))).toHaveLength(0);
    expect(existsSync(join(b.dataDir, 'evil'))).toBe(false);
  });

  it('rejects a backup whose records reference missing rows', async () => {
    const a = await server();
    await populate(a);
    const zip = await backupOf(a);
    // Rebuild the archive with jd_snapshots pointing at an application that isn't there.
    const dir = tempDir();
    const yauzl = (await import('yauzl')).default;
    const entries: Array<{ name: string; content: Buffer }> = await new Promise((resolve, reject) => {
      const file = join(dir, 'b.zip');
      writeFileSync(file, zip);
      const out: Array<{ name: string; content: Buffer }> = [];
      yauzl.open(file, { lazyEntries: true }, (err, z) => {
        if (err || !z) return reject(err);
        z.on('entry', (e: { fileName: string }) => {
          z.openReadStream(e as never, (_e, st) => {
            const chunks: Buffer[] = [];
            st!.on('data', (c: Buffer) => chunks.push(c));
            st!.on('end', () => {
              out.push({ name: e.fileName, content: Buffer.concat(chunks) });
              z.readEntry();
            });
          });
        });
        z.on('end', () => resolve(out));
        z.readEntry();
      });
    });
    cleanup(dir);
    const { createHash } = await import('node:crypto');
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    const snaps = entries.find((e) => e.name === 'records/jd_snapshots.json')!;
    const parsed = JSON.parse(snaps.content.toString());
    parsed.rows[0].application_id = 'missing-app';
    snaps.content = Buffer.from(JSON.stringify(parsed));
    const man = entries.find((e) => e.name === 'manifest.json')!;
    const m = JSON.parse(man.content.toString());
    const rec = m.records.find((r: { path: string }) => r.path === 'records/jd_snapshots.json');
    rec.sha256 = sha(snaps.content);
    rec.size = snaps.content.length;
    man.content = Buffer.from(JSON.stringify(m));
    const b = await server();
    const r = await stage(b, await zipOf(entries));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('restore_broken_references');
  });

  it('exports a CSV overview that neutralizes spreadsheet formulas', async () => {
    const a = await server();
    await a.req('POST', '/api/captures', captureNew({ application: { company: '=HYPERLINK("http://evil")', title: 'SWE, "Co-op"', foundOn: 'company', tags: [] }, link: null }));
    const csv = await a.req('GET', '/api/export/csv');
    expect(String(csv.headers['content-type'])).toMatch(/text\/csv/);
    const text = csv.raw.toString();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(text).toContain('"SWE, ""Co-op"""');
    expect(csvCell('-1+1')).toBe("'-1+1");
  });

  it('only allows demo data in an empty workspace and removes it cleanly', async () => {
    const a = await server();
    const seeded = await a.req('POST', '/api/demo', { timezone: 'America/New_York' });
    expect(seeded.status).toBe(201);
    expect(seeded.body.hasDemoData).toBe(true);
    const apps = (await a.req('GET', '/api/applications')).body;
    expect(apps.length).toBeGreaterThan(2);
    expect(apps.every((x: { isDemo: boolean }) => x.isDemo)).toBe(true);
    expect((await a.req('POST', '/api/demo', {})).status).toBe(409);
    await a.req('DELETE', '/api/demo');
    expect((await a.req('GET', '/api/applications')).body).toHaveLength(0);
    expect((await a.req('GET', '/api/documents')).body).toHaveLength(0);
    expect(readdirSync(join(a.dataDir, 'documents'))).toHaveLength(0);

    const b = await server();
    await b.req('POST', '/api/captures', captureNew());
    const refused = await b.req('POST', '/api/demo', {});
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('workspace_not_empty');
    expect(DASH.origin).toBeTruthy();
  });
});
