import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { DOCUMENT_MIME } from '@appfolio/shared';
import { AppError } from './errors.js';

export interface StagedFile {
  tmpPath: string;
  sha256: string;
  size: number;
}

export type SniffedType = { kind: 'pdf' | 'docx'; mime: string };

const STORAGE_KEY_RE = /^[a-f0-9]{32}$/;

/**
 * Content storage for uploaded documents.
 * Files are stored under generated keys (never user filenames), written to a staging
 * directory first, and only moved into place once validated. Physical deletion is
 * deferred while a backup is reading files.
 */
export class FileStore {
  readonly docsDir: string;
  readonly tmpDir: string;
  private backupReaders = 0;
  private deferredDeletes = new Set<string>();

  constructor(readonly dataDir: string) {
    this.docsDir = join(dataDir, 'documents');
    this.tmpDir = join(dataDir, 'tmp');
  }

  async init() {
    for (const dir of [this.dataDir, this.docsDir, this.tmpDir]) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await chmod(dir, 0o700).catch(() => undefined);
    }
  }

  pathFor(storageKey: string): string {
    if (!STORAGE_KEY_RE.test(storageKey)) throw new AppError(500, 'bad_storage_key', 'Invalid storage key');
    return join(this.docsDir, storageKey);
  }

  newKey(): string {
    return randomBytes(16).toString('hex');
  }

  /** Stream an upload into the staging area, hashing it and enforcing the size limit. */
  async stage(source: Readable, maxBytes: number): Promise<StagedFile> {
    const tmpPath = join(this.tmpDir, `upload-${randomBytes(12).toString('hex')}`);
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) {
          cb(new AppError(413, 'file_too_large', `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(source, meter, createWriteStream(tmpPath, { mode: 0o600, flags: 'wx' }));
      // Multipart parsers may truncate silently at their own limit.
      if ((source as Readable & { truncated?: boolean }).truncated) {
        throw new AppError(413, 'file_too_large', `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
      }
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
    if (size === 0) {
      await rm(tmpPath, { force: true });
      throw new AppError(400, 'empty_file', 'The uploaded file is empty');
    }
    return { tmpPath, sha256: hash.digest('hex'), size };
  }

  /** Detect PDF/DOCX from the bytes themselves; the filename extension is not trusted. */
  async sniff(staged: StagedFile): Promise<SniffedType | null> {
    const fh = await open(staged.tmpPath, 'r');
    const head = Buffer.alloc(8);
    try {
      await fh.read(head, 0, 8, 0);
    } finally {
      await fh.close();
    }
    if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: DOCUMENT_MIME.pdf };
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
      const names = await zipEntryNames(staged.tmpPath, 5000).catch(() => null);
      if (names && names.has('[Content_Types].xml') && names.has('word/document.xml')) return { kind: 'docx', mime: DOCUMENT_MIME.docx };
    }
    return null;
  }

  /** Move a validated staged file into permanent storage. Returns its storage key. */
  async commit(staged: StagedFile): Promise<string> {
    const key = this.newKey();
    const dest = this.pathFor(key);
    const fh = await open(staged.tmpPath, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(staged.tmpPath, dest);
    await chmod(dest, 0o400).catch(() => undefined);
    return key;
  }

  async discard(staged: StagedFile) {
    await rm(staged.tmpPath, { force: true });
  }

  async remove(storageKey: string) {
    if (this.backupReaders > 0) {
      this.deferredDeletes.add(storageKey);
      return;
    }
    await rm(this.pathFor(storageKey), { force: true });
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      return (await stat(this.pathFor(storageKey))).isFile();
    } catch {
      return false;
    }
  }

  /** While held, physical deletions are queued so a backup sees a consistent file set. */
  async withBackupRead<T>(fn: () => Promise<T>): Promise<T> {
    this.backupReaders++;
    try {
      return await fn();
    } finally {
      this.backupReaders--;
      if (this.backupReaders === 0) {
        const keys = [...this.deferredDeletes];
        this.deferredDeletes.clear();
        for (const k of keys) await rm(this.pathFor(k), { force: true });
      }
    }
  }

  /**
   * Startup maintenance: clear abandoned staging files and move stored files that no
   * database row references (left behind by a crash between file write and DB commit)
   * into `<dataDir>/orphaned/`. They're moved, not deleted, so nothing is lost if a
   * reference was wrong.
   */
  async cleanup(referencedKeys: Set<string>): Promise<{ orphansRemoved: number; missing: string[] }> {
    await rm(this.tmpDir, { recursive: true, force: true });
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    let orphansRemoved = 0;
    const present = new Set<string>();
    for (const name of await readdir(this.docsDir)) {
      if (!STORAGE_KEY_RE.test(name)) continue;
      present.add(name);
      if (!referencedKeys.has(name)) {
        const quarantine = join(this.dataDir, 'orphaned');
        await mkdir(quarantine, { recursive: true, mode: 0o700 });
        await rename(join(this.docsDir, name), join(quarantine, name));
        orphansRemoved++;
      }
    }
    const missing = [...referencedKeys].filter((k) => !present.has(k));
    return { orphansRemoved, missing };
  }
}

export function zipEntryNames(file: string, maxEntries: number): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip open failed'));
      if (zip.entryCount > maxEntries) {
        zip.close();
        return reject(new Error('too many entries'));
      }
      const names = new Set<string>();
      zip.on('entry', (entry: yauzl.Entry) => {
        names.add(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}
