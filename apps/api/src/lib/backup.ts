import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { APP_VERSION, BACKUP_FORMAT, BACKUP_FORMAT_VERSION, type RestoreSummary } from '@appfolio/shared';
import { openDatabase, schemaVersion, migrate, transaction, type DB } from '../db/index.js';
import { BACKUP_TABLES, CURRENT_SCHEMA_VERSION } from '../db/migrations.js';
import type { Ctx } from '../store/core.js';
import { AppError } from './errors.js';
import { nowIso } from './util.js';

export const DB_FILENAME = 'appfolio.db';

interface ManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  createdAt: string;
  notice: string;
  counts: Record<string, number>;
  records: Array<ManifestEntry & { table: string; rows: number }>;
  files: Array<ManifestEntry & { documentId: string; storageKey: string }>;
}

const NOTICE =
  'This archive contains your personal documents (resumes, cover letters) and saved job descriptions. Keep it private. It does not contain extension pairing tokens.';

function hashFile(path: string): Promise<{ sha256: string; size: number }> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    let size = 0;
    createReadStream(path)
      .on('data', (c) => {
        const chunk = c as Buffer;
        size += chunk.length;
        h.update(chunk);
      })
      .on('end', () => resolve({ sha256: h.digest('hex'), size }))
      .on('error', reject);
  });
}

/**
 * Write a complete backup ZIP.
 *
 * Consistency: the database is copied with SQLite's online backup API, which yields a
 * consistent point-in-time snapshot even while the app keeps writing. Records are read from
 * that snapshot. Document bytes are immutable and stored under unique keys, and physical
 * deletion is deferred while the backup runs, so every file the snapshot references is still
 * readable. Each file is re-hashed and checked against its recorded hash.
 */
export async function createBackupZip(ctx: Ctx, outPath: string): Promise<BackupManifest> {
  const work = join(ctx.files.tmpDir, `backup-${randomUUID()}`);
  await mkdir(work, { recursive: true, mode: 0o700 });
  const snapPath = join(work, 'snapshot.db');
  try {
    await sqliteBackup(ctx.db, snapPath);
    return await ctx.files.withBackupRead(async () => {
      const snap = new DatabaseSync(snapPath, { readOnly: true });
      try {
        const zip = new yazl.ZipFile();
        const out = createWriteStream(outPath, { mode: 0o600 });
        const done = pipeline(zip.outputStream, out);
        const manifest: BackupManifest = {
          format: BACKUP_FORMAT,
          formatVersion: BACKUP_FORMAT_VERSION,
          schemaVersion: schemaVersion(snap),
          appVersion: APP_VERSION,
          createdAt: nowIso(),
          notice: NOTICE,
          counts: {},
          records: [],
          files: [],
        };
        for (const table of BACKUP_TABLES) {
          const rows = snap.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
          const buf = Buffer.from(JSON.stringify({ table, schemaVersion: manifest.schemaVersion, rows }, null, 1));
          const path = `records/${table}.json`;
          zip.addBuffer(buf, path);
          manifest.counts[table] = rows.length;
          manifest.records.push({ path, table, rows: rows.length, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') });
        }
        const docs = snap.prepare('SELECT id, storage_key, content_hash, byte_size FROM documents').all() as Array<Record<string, string | number>>;
        for (const d of docs) {
          const src = ctx.files.pathFor(String(d.storage_key));
          const { sha256, size } = await hashFile(src).catch(() => {
            throw new AppError(500, 'backup_missing_file', `A stored document is missing from disk (document ${d.id}). Backup aborted.`);
          });
          if (sha256 !== d.content_hash || size !== Number(d.byte_size)) {
            throw new AppError(500, 'backup_corrupt_file', `A stored document does not match its recorded hash (document ${d.id}). Backup aborted.`);
          }
          const path = `documents/${d.storage_key}`;
          zip.addFile(src, path, { compress: false });
          manifest.files.push({ path, sha256, size, documentId: String(d.id), storageKey: String(d.storage_key) });
        }
        zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
        zip.end();
        await done;
        return manifest;
      } finally {
        snap.close();
      }
    });
  } catch (err) {
    await rm(outPath, { force: true });
    throw err;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---------------- Restore ----------------

interface StagedRestore {
  id: string;
  dir: string;
  summary: RestoreSummary;
  createdAt: number;
}

const ENTRY_RE = /^(manifest\.json|records\/[a-z_]+\.json|documents\/[a-f0-9]{32})$/;
const DIR_RE = /^(records|documents)\/$/;
const MAX_ENTRIES = 20_000;
const MAX_RECORD_ENTRY = 512 * 1024 * 1024;
const MAX_MANIFEST = 16 * 1024 * 1024;
const MAX_RATIO = 200;

export function validateEntryName(name: string): 'file' | 'dir' {
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(name) || /^[a-zA-Z]:/.test(name)) {
    throw new AppError(400, 'restore_bad_path', `Unsafe path in archive: ${JSON.stringify(name.slice(0, 100))}`);
  }
  if (DIR_RE.test(name)) return 'dir';
  if (!ENTRY_RE.test(name)) throw new AppError(400, 'restore_unexpected_entry', `Unexpected file in archive: ${JSON.stringify(name.slice(0, 100))}`);
  return 'file';
}

/** Extract an archive into `dest`, validating every path and size before and during extraction. */
function extractArchive(zipPath: string, dest: string, limits: { maxTotal: number; maxDocument: number }): Promise<Map<string, { sha256: string; size: number }>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => {
      if (err || !zip) return reject(new AppError(400, 'restore_not_zip', 'This file is not a readable ZIP archive.'));
      if (zip.entryCount > MAX_ENTRIES) {
        zip.close();
        return reject(new AppError(400, 'restore_too_many_entries', 'Archive has too many entries.'));
      }
      const seen = new Map<string, { sha256: string; size: number }>();
      let total = 0;
      const fail = (e: unknown) => {
        try {
          zip.close();
        } catch {
          /* already closed */
        }
        reject(e);
      };
      zip.on('error', (e) => {
        const msg = (e as Error).message;
        // yauzl validates names too; report its path errors as unsafe paths.
        if (/invalid (relative|absolute) path|absolute path|invalid characters in fileName/i.test(msg)) {
          return fail(new AppError(400, 'restore_bad_path', `Unsafe path in archive: ${msg}`));
        }
        fail(new AppError(400, 'restore_corrupt', `Archive is corrupt: ${msg}`));
      });
      zip.on('end', () => resolve(seen));
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          const kind = validateEntryName(entry.fileName);
          if (kind === 'dir') return zip.readEntry();
          if (seen.has(entry.fileName)) throw new AppError(400, 'restore_duplicate_entry', `Duplicate entry: ${entry.fileName}`);
          if (entry.generalPurposeBitFlag & 0x1) throw new AppError(400, 'restore_encrypted', 'Encrypted archives are not supported.');
          const limit = entry.fileName === 'manifest.json' ? MAX_MANIFEST : entry.fileName.startsWith('records/') ? MAX_RECORD_ENTRY : limits.maxDocument;
          if (entry.uncompressedSize > limit) throw new AppError(400, 'restore_entry_too_large', `${entry.fileName} is larger than allowed.`);
          total += entry.uncompressedSize;
          if (total > limits.maxTotal) throw new AppError(400, 'restore_too_large', 'Archive expands beyond the allowed size.');
          if (entry.uncompressedSize > 1024 * 1024 && entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_RATIO) {
            throw new AppError(400, 'restore_suspicious_ratio', `${entry.fileName} has a suspicious compression ratio.`);
          }
        } catch (e) {
          return fail(e);
        }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2 || !stream) return fail(new AppError(400, 'restore_corrupt', 'Could not read archive entry.'));
          const target = join(dest, entry.fileName);
          const h = createHash('sha256');
          let size = 0;
          stream.on('data', (c: Buffer) => {
            size += c.length;
            h.update(c);
          });
          pipeline(stream as Readable, createWriteStream(target, { mode: 0o600, flags: 'wx' }))
            .then(() => {
              seen.set(entry.fileName, { sha256: h.digest('hex'), size });
              zip.readEntry();
            })
            .catch((e3) => fail(new AppError(400, 'restore_corrupt', `Archive entry failed to extract: ${(e3 as Error).message}`)));
        });
      });
      zip.readEntry();
    });
  });
}

function tableColumns(db: DB, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

export class RestoreManager {
  private staged = new Map<string, StagedRestore>();

  constructor(private ctx: Ctx) {}

  /** Validate and stage an uploaded archive. Active data is not touched. */
  async stage(upload: Readable): Promise<RestoreSummary> {
    this.expireOld();
    const id = randomUUID();
    const dir = join(this.ctx.files.tmpDir, `restore-${id}`);
    await mkdir(join(dir, 'archive', 'records'), { recursive: true, mode: 0o700 });
    await mkdir(join(dir, 'archive', 'documents'), { recursive: true, mode: 0o700 });
    try {
      const staged = await this.ctx.files.stage(upload, this.ctx.config.maxRestoreBytes).catch((e) => {
        if (e instanceof AppError && e.code === 'empty_file') throw new AppError(400, 'restore_empty', 'The uploaded backup is empty.');
        throw e;
      });
      const zipPath = join(dir, 'upload.zip');
      await rename(staged.tmpPath, zipPath);
      const extracted = await extractArchive(zipPath, join(dir, 'archive'), {
        maxTotal: this.ctx.config.maxRestoreBytes,
        maxDocument: Math.max(this.ctx.config.maxUploadBytes, 200 * 1024 * 1024),
      });
      await rm(zipPath, { force: true });
      const summary = await this.validateAndBuild(id, dir, extracted);
      this.staged.set(id, { id, dir, summary, createdAt: Date.now() });
      return summary;
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  private async validateAndBuild(id: string, dir: string, extracted: Map<string, { sha256: string; size: number }>): Promise<RestoreSummary> {
    const archive = join(dir, 'archive');
    if (!extracted.has('manifest.json')) throw new AppError(400, 'restore_no_manifest', 'This archive has no manifest.json; it is not an Appfolio backup.');
    let manifest: BackupManifest;
    try {
      manifest = JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8')) as BackupManifest;
    } catch {
      throw new AppError(400, 'restore_bad_manifest', 'manifest.json is not valid JSON.');
    }
    if (manifest.format !== BACKUP_FORMAT) throw new AppError(400, 'restore_bad_manifest', 'This is not an Appfolio backup archive.');
    if (!Number.isInteger(manifest.formatVersion) || manifest.formatVersion > BACKUP_FORMAT_VERSION) {
      throw new AppError(400, 'restore_newer_format', `This backup uses archive format ${manifest.formatVersion}, which is newer than this version of Appfolio supports (${BACKUP_FORMAT_VERSION}). Update Appfolio, then restore again.`);
    }
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) throw new AppError(400, 'restore_bad_manifest', 'Manifest has no valid schema version.');
    if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new AppError(400, 'restore_newer_schema', `This backup was made with database schema ${manifest.schemaVersion}; this version of Appfolio supports up to ${CURRENT_SCHEMA_VERSION}. Update Appfolio, then restore again.`);
    }
    if (!Array.isArray(manifest.records) || !Array.isArray(manifest.files)) throw new AppError(400, 'restore_bad_manifest', 'Manifest is missing its record or file list.');

    // Every listed entry must exist with the right hash and size; nothing unlisted may be present.
    const listed = new Set<string>(['manifest.json']);
    for (const e of [...manifest.records, ...manifest.files]) {
      if (typeof e?.path !== 'string' || typeof e.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.sha256) || typeof e.size !== 'number') {
        throw new AppError(400, 'restore_missing_hash', 'Manifest entry is missing a valid hash or size.');
      }
      validateEntryName(e.path);
      const got = extracted.get(e.path);
      if (!got) throw new AppError(400, 'restore_missing_entry', `Archive is missing ${e.path}.`);
      if (got.sha256 !== e.sha256 || got.size !== e.size) throw new AppError(400, 'restore_hash_mismatch', `${e.path} does not match the hash recorded in the manifest.`);
      listed.add(e.path);
    }
    for (const name of extracted.keys()) if (!listed.has(name)) throw new AppError(400, 'restore_unexpected_entry', `Archive contains an unlisted file: ${name}`);

    // Build the staged database at the backup's schema version, then migrate forward.
    const dbPath = join(dir, DB_FILENAME);
    const db = openDatabase(dbPath, { migrateTo: manifest.schemaVersion });
    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    try {
      const byTable = new Map(manifest.records.map((r) => [r.table, r]));
      // Insert with FK enforcement off so the order of rows doesn't matter, then verify all
      // references at once with foreign_key_check (which fails the restore if any are broken).
      db.exec('PRAGMA foreign_keys = OFF');
      try {
      transaction(db, () => {
        for (const table of BACKUP_TABLES) {
          const entry = byTable.get(table);
          if (!entry) throw new AppError(400, 'restore_missing_table', `Backup is missing records for ${table}.`);
          const parsed = JSON.parse(readFileSync(join(archive, entry.path), 'utf8')) as { table: string; rows: Array<Record<string, unknown>> };
          if (parsed.table !== table || !Array.isArray(parsed.rows)) throw new AppError(400, 'restore_bad_records', `Records for ${table} are malformed.`);
          const cols = tableColumns(db, table);
          for (const row of parsed.rows) {
            if (!row || typeof row !== 'object') throw new AppError(400, 'restore_bad_records', `A ${table} record is malformed.`);
            const keys = Object.keys(row);
            for (const k of keys) if (!cols.has(k)) throw new AppError(400, 'restore_bad_records', `Unknown column ${table}.${k} in backup.`);
            const values = keys.map((k) => {
              const v = row[k];
              if (v === null || typeof v === 'string' || typeof v === 'number') return v;
              throw new AppError(400, 'restore_bad_records', `Invalid value type in ${table}.${k}.`);
            });
            try {
              db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(values as Array<string | number | null>));
            } catch (e) {
              throw new AppError(400, 'restore_bad_records', `A ${table} record could not be imported: ${(e as Error).message}`);
            }
          }
          counts[table] = parsed.rows.length;
        }
        const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
        if (fkProblems.length) throw new AppError(400, 'restore_broken_references', `Backup has ${fkProblems.length} broken reference(s) between records.`);
      });
      } finally {
        db.exec('PRAGMA foreign_keys = ON');
      }
      migrate(db);
      const integrity = db.prepare('PRAGMA integrity_check').get() as Record<string, string>;
      if (Object.values(integrity)[0] !== 'ok') throw new AppError(400, 'restore_integrity', 'Restored database failed its integrity check.');

      // Every document row must have its bytes in the archive, matching hash and size.
      const fileByKey = new Map(manifest.files.map((f) => [f.storageKey, f]));
      let documentBytes = 0;
      const docs = db.prepare('SELECT id, storage_key, content_hash, byte_size FROM documents').all() as Array<Record<string, string | number>>;
      for (const d of docs) {
        const f = fileByKey.get(String(d.storage_key));
        if (!f || f.path !== `documents/${d.storage_key}`) throw new AppError(400, 'restore_missing_document', `Backup is missing the file for document ${d.id}.`);
        if (f.sha256 !== d.content_hash || f.size !== Number(d.byte_size)) throw new AppError(400, 'restore_hash_mismatch', `File for document ${d.id} does not match its record.`);
        documentBytes += f.size;
      }
      if (manifest.files.length > docs.length) warnings.push(`${manifest.files.length - docs.length} file(s) in the archive are not referenced by any record and will be ignored.`);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.exec('PRAGMA journal_mode = DELETE');

      return {
        stagingId: id,
        createdAt: manifest.createdAt,
        schemaVersion: manifest.schemaVersion,
        counts,
        documentBytes,
        warnings,
        currentWorkspaceEmpty: isWorkspaceEmpty(this.ctx.db),
      };
    } finally {
      db.close();
    }
  }

  private expireOld() {
    for (const [id, s] of this.staged) {
      if (Date.now() - s.createdAt > 60 * 60_000) {
        this.staged.delete(id);
        void rm(s.dir, { recursive: true, force: true });
      }
    }
  }

  async discard(id: string) {
    const s = this.staged.get(id);
    if (!s) return;
    this.staged.delete(id);
    await rm(s.dir, { recursive: true, force: true });
  }

  /**
   * Replace the active workspace with a staged restore.
   * - 'empty' mode refuses unless the current workspace has no records.
   * - 'replace' mode requires confirm === 'REPLACE' and first writes a recovery backup to
   *   <dataDir>/backups/.
   * The swap moves the old database and documents aside, moves the staged ones in, and
   * reopens; if anything fails the old files are moved back.
   */
  async apply(id: string, mode: 'empty' | 'replace', confirm: string | undefined, reopen: (db: DB) => void): Promise<{ recoveryBackup: string | null }> {
    const s = this.staged.get(id);
    if (!s) throw new AppError(404, 'restore_not_staged', 'This restore has expired or was already applied. Upload the backup again.');
    let recoveryBackup: string | null = null;
    if (mode === 'empty') {
      if (!isWorkspaceEmpty(this.ctx.db)) throw new AppError(409, 'workspace_not_empty', 'The current workspace is not empty. Use “Replace current workspace” instead.');
    } else {
      if (confirm !== 'REPLACE') throw new AppError(400, 'confirmation_required', 'Type REPLACE to confirm replacing the current workspace.');
      const dir = join(this.ctx.config.dataDir, 'backups');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      recoveryBackup = join(dir, `recovery-before-restore-${nowIso().replace(/[:.]/g, '-')}.appfolio-backup.zip`);
      await createBackupZip(this.ctx, recoveryBackup);
    }

    const dataDir = this.ctx.config.dataDir;
    const liveDb = join(dataDir, DB_FILENAME);
    const liveDocs = this.ctx.files.docsDir;
    const aside = join(dataDir, `restore-previous-${Date.now()}`);
    const stagedDb = join(s.dir, DB_FILENAME);
    const stagedDocs = join(s.dir, 'archive', 'documents');
    const moved: Array<[string, string]> = [];
    const move = (from: string, to: string) => {
      renameSync(from, to);
      moved.push([from, to]);
    };

    // Everything below is synchronous so no request can run against a half-swapped workspace.
    this.ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.ctx.db.close();
    try {
      mkdirSync(aside, { recursive: true, mode: 0o700 });
      for (const suffix of ['', '-wal', '-shm']) if (existsSync(liveDb + suffix)) move(liveDb + suffix, join(aside, DB_FILENAME + suffix));
      if (existsSync(liveDocs)) move(liveDocs, join(aside, 'documents'));
      move(stagedDb, liveDb);
      move(stagedDocs, liveDocs);
      const db = openDatabase(liveDb);
      reopen(db);
    } catch (err) {
      for (const [from, to] of moved.reverse()) {
        try {
          renameSync(to, from);
        } catch {
          /* best effort; see docs/BACKUP_RESTORE.md for manual recovery */
        }
      }
      reopen(openDatabase(liveDb));
      throw new AppError(500, 'restore_failed', `Restore failed and the previous workspace was put back: ${(err as Error).message}`);
    }
    this.staged.delete(id);
    rmSync(aside, { recursive: true, force: true });
    rmSync(s.dir, { recursive: true, force: true });
    return { recoveryBackup };
  }
}

export function isWorkspaceEmpty(db: DB): boolean {
  const n = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
  return n('SELECT COUNT(*) AS n FROM applications') === 0 && n('SELECT COUNT(*) AS n FROM documents') === 0;
}
