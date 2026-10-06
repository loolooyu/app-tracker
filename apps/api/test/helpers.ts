import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import yazl from 'yazl';
import type { Config } from '../src/config.js';
import { buildServer, type AppServer } from '../src/server.js';

export const PORT = 4317;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const DASH = { host: `127.0.0.1:${PORT}`, origin: ORIGIN, 'x-appfolio-client': 'dashboard', 'sec-fetch-site': 'same-origin' };
export const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

export function tempDir(prefix = 'appfolio-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function testConfig(dataDir: string, over: Partial<Config> = {}): Config {
  return {
    dataDir,
    host: '127.0.0.1',
    port: PORT,
    maxUploadBytes: 2 * 1024 * 1024,
    webDist: null,
    devOrigins: [],
    maxRestoreBytes: 200 * 1024 * 1024,
    logLevel: 'silent',
    ...over,
  };
}

export interface TestServer extends AppServer {
  dataDir: string;
  req<T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; raw: Buffer; headers: Record<string, unknown> }>;
  upload(url: string, file: { filename: string; content: Buffer; contentType?: string }, fields?: Record<string, string>): Promise<{ status: number; body: any }>;
  dispose(): Promise<void>;
}

export async function startServer(dataDir = tempDir(), over: Partial<Config> = {}): Promise<TestServer> {
  const server = await buildServer(testConfig(dataDir, over));
  const req: TestServer['req'] = async (method, url, body, headers = {}) => {
    const res = await server.app.inject({
      method: method as 'GET',
      url,
      headers: { ...DASH, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let parsed: unknown = undefined;
    const ct = String(res.headers['content-type'] ?? '');
    if (ct.includes('application/json') && res.body) parsed = JSON.parse(res.body);
    return { status: res.statusCode, body: parsed as any, raw: res.rawPayload, headers: res.headers };
  };
  const upload: TestServer['upload'] = async (url, file, fields = {}) => {
    const boundary = '----appfolio' + randomUUID();
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      file.content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    );
    const res = await server.app.inject({
      method: 'POST',
      url,
      headers: { ...DASH, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  };
  return {
    ...server,
    dataDir,
    req,
    upload,
    async dispose() {
      await server.close();
    },
  };
}

export function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

/** Minimal PDF bytes with a distinguishing marker. */
export function pdf(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
}

/** Minimal DOCX container (enough for type sniffing). */
export function docx(text: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), '[Content_Types].xml');
    zip.addBuffer(Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`), 'word/document.xml');
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

export function zipOf(entries: Array<{ name: string; content: Buffer | string }>): Promise<Buffer> {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile();
    for (const e of entries) zip.addBuffer(Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content), e.name);
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

export const JD_TEXT = `What you'll do

• Implement motion-planning features in C++.
• Write quaternion calibration tooling for our arm fleet.

Qualifications

• Pursuing a BS in CS.

Compensation

$32–$40 per hour.`;

export function captureNew(over: Record<string, unknown> = {}) {
  return {
    mode: 'new',
    captureId: randomUUID(),
    application: { company: 'Northwind Robotics', title: 'Robotics Software Engineer Co-op', location: 'Boston, MA', foundOn: 'nuworks', tags: [] },
    link: { url: 'https://jobs.university.test/jobs/88213?utm_source=email', platform: 'nuworks', relationship: 'discovery' },
    snapshot: { sourceUrl: 'https://jobs.university.test/jobs/88213', rawText: JD_TEXT, reviewedText: JD_TEXT, method: 'generic_dom', warnings: [], reviewConfirmed: true },
    ...over,
  };
}

/**
 * Hand-built ZIP (stored, no compression) that allows arbitrary entry names, including the
 * malicious ones (../, absolute paths) that zip libraries refuse to write.
 */
export function rawZip(entries: Array<{ name: string; content: Buffer | string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.content) ? e.content : Buffer.from(e.content);
    const name = Buffer.from(e.name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
