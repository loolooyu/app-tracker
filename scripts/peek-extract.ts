// Dev helper: print what the extractor produces for a fixture or a saved local HTML file.
// Usage: npx tsx scripts/peek-extract.ts <file.html> [page-url]
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractJob } from '../packages/shared/src/extract/index.js';

const [file, url = 'https://example.test/job'] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npx tsx scripts/peek-extract.ts <file.html> [page-url]');
  process.exit(1);
}
const doc = new JSDOM(readFileSync(file, 'utf8'), { url }).window.document;
const job = extractJob(doc, { url });
const { text, alternatives, ...meta } = job;
console.log(JSON.stringify({ ...meta, alternatives: alternatives.map((a) => `${a.method} (${a.text.length} chars)`) }, null, 2));
console.log('----- text -----\n' + text);
