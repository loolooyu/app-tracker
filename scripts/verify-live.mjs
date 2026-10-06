// Check extraction against a real, PUBLIC job page in Google Chrome, using the same built
// capture script the extension injects. Prints a summary only; the page text is not saved.
//
//   npm run build -w @appfolio/extension
//   node scripts/verify-live.mjs <public-job-url> [--nuworks-host <host>] [--show-text]
//
// Signed-in pages (NUworks, LinkedIn, Handshake) can't be checked this way: use the
// extension in your own browser session and follow docs/PLATFORM_SUPPORT.md.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.error('Usage: node scripts/verify-live.mjs <public-job-url> [--nuworks-host <host>] [--show-text]');
  process.exit(1);
}
const hostIdx = args.indexOf('--nuworks-host');
const nuworksHosts = hostIdx >= 0 ? [args[hostIdx + 1]] : [];
const script = readFileSync(new URL('../apps/extension/dist/capture.js', import.meta.url), 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
// bypassCSP: extension content scripts aren't subject to the page's CSP, so this matches them.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, bypassCSP: true });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
// Content scripts run in an isolated world in the extension; here we evaluate in the page,
// which is equivalent for reading the DOM.
await page.addScriptTag({ content: script });
const job = await page.evaluate((hosts) => globalThis.__appfolioCapture({ nuworksHosts: hosts, maxWaitMs: 6000 }), nuworksHosts);
await browser.close();

const lines = job.text.split('\n').filter(Boolean);
console.log(JSON.stringify({
  url: job.url,
  platform: job.platform,
  adapter: job.adapter,
  method: job.method,
  title: job.title,
  company: job.company,
  location: job.location,
  jobId: job.jobId,
  chars: job.text.length,
  bullets: lines.filter((l) => l.trim().startsWith('•')).length,
  firstLines: lines.slice(0, 4),
  warnings: job.warnings,
  alternatives: job.alternatives.map((a) => `${a.method}: ${a.text.length} chars`),
}, null, 2));
if (args.includes('--show-text')) console.log('\n' + job.text);
