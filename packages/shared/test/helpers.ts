import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const pagesDir = fileURLToPath(new URL('../../../tests/fixtures/pages/', import.meta.url));

/** Load a fixture into jsdom with scripts disabled (as captured content must never execute). */
export function loadFixture(name: string, url = `https://example.test/${name}`): Document {
  const html = readFileSync(pagesDir + name, 'utf8');
  return new JSDOM(html, { url, runScripts: undefined }).window.document;
}
