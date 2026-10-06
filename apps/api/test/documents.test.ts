import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureNew, cleanup, docx, pdf, startServer, type TestServer } from './helpers.js';

let s: TestServer;
beforeEach(async () => {
  s = await startServer();
});
afterEach(async () => {
  await s.dispose();
  cleanup(s.dataDir);
});

const storedFiles = (dir: string) => readdirSync(join(dir, 'documents'));
const tmpFiles = (dir: string) => readdirSync(join(dir, 'tmp'));

describe('resume library', () => {
  it('keeps two files with the same filename but different bytes distinct', async () => {
    const a = await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('version A') }, { type: 'resume', label: 'SWE v1' });
    const b = await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('version B') }, { type: 'resume', label: 'SWE v2' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.document.id).not.toBe(b.body.document.id);
    expect(a.body.document.contentHash).not.toBe(b.body.document.contentHash);
    expect(a.body.document.originalFilename).toBe('Resume.pdf');
    expect(storedFiles(s.dataDir)).toHaveLength(2);
  });

  it('reuses identical bytes and says so, without overwriting the existing label', async () => {
    const a = await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('same') }, { type: 'resume', label: 'Original label' });
    const again = await s.upload('/api/documents', { filename: 'Renamed copy.pdf', content: pdf('same') }, { type: 'resume', label: 'New label' });
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);
    expect(again.body.document.id).toBe(a.body.document.id);
    expect(again.body.document.label).toBe('Original label');
    expect(storedFiles(s.dataDir)).toHaveLength(1);
  });

  it('accepts DOCX by content and rejects files whose bytes are not PDF/DOCX, whatever the extension', async () => {
    const d = await s.upload('/api/documents', { filename: 'Cover.docx', content: await docx('Dear team') }, { type: 'cover_letter' });
    expect(d.status).toBe(201);
    expect(d.body.document.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const fake = await s.upload('/api/documents', { filename: 'resume.pdf', content: Buffer.from('<html><script>alert(1)</script></html>') }, { type: 'resume' });
    expect(fake.status).toBe(415);
    const zipNotDocx = await s.upload('/api/documents', { filename: 'resume.docx', content: Buffer.from('PK\u0003\u0004 not really') }, { type: 'resume' });
    expect(zipNotDocx.status).toBe(415);
    expect((await s.req('GET', '/api/documents')).body).toHaveLength(1);
    expect(storedFiles(s.dataDir)).toHaveLength(1);
    expect(tmpFiles(s.dataDir)).toHaveLength(0);
  });

  it('rejects oversized uploads without leaving partial files', async () => {
    const big = Buffer.concat([pdf('big'), Buffer.alloc(3 * 1024 * 1024, 0x20)]);
    const r = await s.upload('/api/documents', { filename: 'big.pdf', content: big }, { type: 'resume' });
    expect(r.status).toBe(413);
    expect((await s.req('GET', '/api/documents')).body).toHaveLength(0);
    expect(storedFiles(s.dataDir)).toHaveLength(0);
    expect(tmpFiles(s.dataDir)).toHaveLength(0);
  });

  it('a database failure during upload leaves no stored file and no record', async () => {
    s.ctx.db.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
    const r = await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('x') }, { type: 'resume' });
    expect(r.status).toBe(500);
    s.ctx.db.exec('DROP TRIGGER fail_insert');
    expect(storedFiles(s.dataDir)).toHaveLength(0);
    expect(tmpFiles(s.dataDir)).toHaveLength(0);
    // And the app recovers: the same upload now works.
    expect((await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('x') }, { type: 'resume' })).status).toBe(201);
  });

  it('downloads exactly the uploaded bytes after an API restart, with the original filename', async () => {
    const bytes = pdf('exact-bytes-ñ');
    const up = await s.upload('/api/documents', { filename: 'Résumé – Alex.pdf', content: bytes }, { type: 'resume' });
    const id = up.body.document.id;
    await s.dispose();
    s = await startServer(s.dataDir);
    const dl = await s.req('GET', `/api/documents/${id}/file`);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.raw, bytes)).toBe(0);
    expect(String(dl.headers['content-type'])).toBe('application/pdf');
    expect(String(dl.headers['content-disposition'])).toContain(`filename*=UTF-8''${encodeURIComponent('Résumé – Alex.pdf')}`);
    expect(String(dl.headers['x-content-type-options'])).toBe('nosniff');
    const inline = await s.req('GET', `/api/documents/${id}/file?disposition=inline`);
    expect(String(inline.headers['content-disposition'])).toMatch(/^inline/);
  });

  it('document bytes and identity are immutable; only the label can change', async () => {
    const up = await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('immutable') }, { type: 'resume', label: 'v1' });
    const id = up.body.document.id;
    const renamed = await s.req('PATCH', `/api/documents/${id}`, { label: 'v1 — robotics' });
    expect(renamed.body.label).toBe('v1 — robotics');
    expect(renamed.body.contentHash).toBe(up.body.document.contentHash);
    expect(() => s.ctx.db.prepare('UPDATE documents SET content_hash = ? WHERE id = ?').run('0'.repeat(64), id)).toThrow(/immutable/);
    expect((await s.req('PATCH', `/api/documents/${id}`, { contentHash: 'x' })).status).toBe(400);
  });
});

describe('submitted documents', () => {
  it('mark applied without a file shows Resume needed until a resume is chosen; reassignment is recorded', async () => {
    const appId = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    const applied = (await s.req('POST', `/api/applications/${appId}/mark-applied`, { submittedAt: '2026-10-01T15:00:00Z', note: 'Applied on Workday' })).body;
    expect(applied.status).toBe('applied');
    expect(applied.resumeNeeded).toBe(true);
    expect((await s.req('GET', '/api/summary')).body.applications).toBe(1);

    const v1 = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('v1') }, { type: 'resume' })).body.document;
    const v2 = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('v2') }, { type: 'resume' })).body.document;
    const withResume = (await s.req('POST', `/api/applications/${appId}/documents`, { kind: 'resume', documentId: v1.id })).body;
    expect(withResume.resumeNeeded).toBe(false);
    expect(withResume.submittedResume.id).toBe(v1.id);
    const corrected = (await s.req('POST', `/api/applications/${appId}/documents`, { kind: 'resume', documentId: v2.id, reason: 'Picked wrong version' })).body;
    const ev = corrected.activity.find((e: { type: string }) => e.type === 'resume_reassigned');
    expect(ev.data).toEqual({ from: v1.id, to: v2.id, reason: 'Picked wrong version' });
    // A cover letter can't be assigned as the resume.
    const cl = (await s.upload('/api/documents', { filename: 'cl.docx', content: await docx('cl') }, { type: 'cover_letter' })).body.document;
    expect((await s.req('POST', `/api/applications/${appId}/documents`, { kind: 'resume', documentId: cl.id })).status).toBe(400);
  });

  it('referenced documents cannot be deleted; bytes stay until associations are resolved', async () => {
    const appId = (await s.req('POST', '/api/captures', captureNew())).body.applicationId;
    const doc = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('ref') }, { type: 'resume' })).body.document;
    await s.req('POST', `/api/applications/${appId}/mark-applied`, { submittedAt: '2026-10-01T15:00:00Z', resumeDocumentId: doc.id });
    const del = await s.req('DELETE', `/api/documents/${doc.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('document_in_use');
    expect(del.body.error.details.linkedApplications[0].id).toBe(appId);
    expect(storedFiles(s.dataDir)).toHaveLength(1);
    expect(() => s.ctx.db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id)).toThrow(); // FK RESTRICT backs this up

    const lib = (await s.req('GET', '/api/documents')).body;
    expect(lib[0].linkedApplications).toEqual([{ id: appId, company: 'Northwind Robotics', title: 'Robotics Software Engineer Co-op', as: 'resume' }]);

    await s.req('POST', `/api/applications/${appId}/documents`, { kind: 'resume', documentId: null, reason: 'unlink' });
    expect((await s.req('DELETE', `/api/documents/${doc.id}`)).status).toBe(204);
    expect(storedFiles(s.dataDir)).toHaveLength(0);
  });

  it('a referenced file missing from disk is reported, not silently served', async () => {
    const doc = (await s.upload('/api/documents', { filename: 'Resume.pdf', content: pdf('gone') }, { type: 'resume' })).body.document;
    const { rmSync } = await import('node:fs');
    for (const f of storedFiles(s.dataDir)) rmSync(join(s.dataDir, 'documents', f), { force: true });
    expect((await s.req('GET', `/api/documents/${doc.id}/file`)).status).toBe(410);
    await s.dispose();
    s = await startServer(s.dataDir);
    expect((await s.req('GET', '/api/status')).body.storage.missingFiles).toBe(1);
  });
});
