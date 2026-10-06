import type { Readable } from 'node:stream';
import type { DocumentRecord, DocumentType } from '@appfolio/shared';
import { transaction } from '../db/index.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { newId, nowIso } from '../lib/util.js';
import { mapDocument, type Ctx } from './core.js';

type Row = Record<string, unknown>;

/** Keep only the base name, strip control characters, cap the length. Used for display/download only. */
export function sanitizeFilename(name: string | undefined | null): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 200);
  return cleaned || 'document';
}

function linkedApplications(ctx: Ctx, docIds: string[]): Map<string, DocumentRecord['linkedApplications']> {
  const map = new Map<string, DocumentRecord['linkedApplications']>();
  if (!docIds.length) return map;
  const ph = docIds.map(() => '?').join(',');
  const rows = ctx.db
    .prepare(
      `SELECT id, company, title, submitted_resume_document_id AS r, submitted_cover_letter_document_id AS c FROM applications
       WHERE submitted_resume_document_id IN (${ph}) OR submitted_cover_letter_document_id IN (${ph}) ORDER BY company COLLATE NOCASE, title`,
    )
    .all(...docIds, ...docIds) as Row[];
  for (const r of rows) {
    for (const [col, as] of [['r', 'resume'], ['c', 'cover_letter']] as const) {
      const docId = r[col] as string | null;
      if (!docId || !docIds.includes(docId)) continue;
      const list = map.get(docId) ?? [];
      list.push({ id: String(r.id), company: String(r.company), title: String(r.title), as });
      map.set(docId, list);
    }
  }
  return map;
}

export function listDocuments(ctx: Ctx, q?: string, type?: DocumentType): DocumentRecord[] {
  const where: string[] = [];
  const params: string[] = [];
  if (q?.trim()) {
    const like = `%${q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    where.push(`(label LIKE ? ESCAPE '\\' OR original_filename LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  const rows = ctx.db.prepare(`SELECT * FROM documents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id`).all(...params) as Row[];
  const linked = linkedApplications(ctx, rows.map((r) => String(r.id)));
  return rows.map((r) => mapDocument(r, linked.get(String(r.id)) ?? []));
}

export function getDocument(ctx: Ctx, id: string): DocumentRecord & { storageKey: string } {
  const r = ctx.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('Document');
  return { ...mapDocument(r, linkedApplications(ctx, [id]).get(id) ?? []), storageKey: String(r.storage_key) };
}

export interface UploadResult {
  document: DocumentRecord;
  /** True when identical bytes were already stored: the existing record (and its label) is returned unchanged. */
  reused: boolean;
}

/**
 * Store an uploaded file. Bytes are staged, size-limited, hashed and type-sniffed before
 * anything becomes visible; the DB row is inserted only after the file is in place, and the
 * file is removed again if the insert fails. A crash in between leaves at worst an
 * unreferenced file, which startup maintenance quarantines.
 */
export async function uploadDocument(
  ctx: Ctx,
  stream: Readable,
  meta: { filename: string; type: DocumentType; label?: string | null; isDemo?: boolean },
): Promise<UploadResult> {
  const staged = await ctx.files.stage(stream, ctx.config.maxUploadBytes);
  let committedKey: string | null = null;
  try {
    const sniffed = await ctx.files.sniff(staged);
    if (!sniffed) throw new AppError(415, 'unsupported_file_type', 'Only PDF and DOCX files are accepted (checked from the file contents, not the extension)');
    const existing = ctx.db.prepare('SELECT * FROM documents WHERE content_hash = ?').get(staged.sha256) as Row | undefined;
    if (existing) {
      await ctx.files.discard(staged);
      return { document: getDocument(ctx, String(existing.id)), reused: true };
    }
    const filename = sanitizeFilename(meta.filename);
    const label = (meta.label ?? '').trim().slice(0, 200) || filename.replace(/\.(pdf|docx)$/i, '');
    committedKey = await ctx.files.commit(staged);
    const id = newId();
    transaction(ctx.db, () => {
      ctx.db
        .prepare(
          'INSERT INTO documents (id, type, label, original_filename, mime_type, byte_size, content_hash, storage_key, created_at, is_demo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(id, meta.type, label, filename, sniffed.mime, staged.size, staged.sha256, committedKey!, nowIso(), meta.isDemo ? 1 : 0);
    });
    return { document: getDocument(ctx, id), reused: false };
  } catch (err) {
    await ctx.files.discard(staged);
    if (committedKey) await ctx.files.remove(committedKey);
    throw err;
  }
}

export function renameDocument(ctx: Ctx, id: string, label: string) {
  getDocument(ctx, id);
  ctx.db.prepare('UPDATE documents SET label = ? WHERE id = ?').run(label, id);
  return getDocument(ctx, id);
}

/** Deletion is blocked while any application references the document. */
export async function deleteDocument(ctx: Ctx, id: string) {
  const doc = getDocument(ctx, id);
  if (doc.linkedApplications.length) {
    throw conflict(
      'document_in_use',
      `This file is the submitted ${doc.type === 'resume' ? 'resume' : 'cover letter'} for ${doc.linkedApplications.length} application(s). Assign a different file to those applications first.`,
      { linkedApplications: doc.linkedApplications },
    );
  }
  transaction(ctx.db, () => {
    ctx.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  });
  await ctx.files.remove(doc.storageKey);
}
