import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiJson, cleanup, launchWithExtension, serviceWorker, startApi, startFixtureServer, tempDir, type Api } from './helpers';

/**
 * These tests run the real unpacked extension in Google Chrome against synthetic fixture
 * pages served from 127.0.0.1. Limitation: a test can't click Chrome's toolbar icon, so
 * capture is triggered by calling the same captureTab() the toolbar handler calls, from the
 * service worker. The extension's 127.0.0.1 host permission (needed to reach the API) is
 * what allows injection here; on real sites, access comes from activeTab at click time.
 */

const API_PORT = 4419;
const FIXTURE_PORT = 4420;

let api: Api;
let dataDir: string;
let profile: string;
let fixtures: Awaited<ReturnType<typeof startFixtureServer>>;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  fixtures = await startFixtureServer(FIXTURE_PORT);
});
test.afterAll(async () => {
  await fixtures.stop();
});
test.beforeEach(async () => {
  dataDir = tempDir('appfolio-e2e-ext-data-');
  profile = tempDir('appfolio-e2e-ext-profile-');
  api = await startApi(dataDir, API_PORT);
  ({ context, extensionId } = await launchWithExtension(profile));
});
test.afterEach(async () => {
  await context?.close().catch(() => undefined);
  await api.stop();
  cleanup(dataDir, profile);
});

async function openPanel(): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

async function pair(panel: Page, request: import('@playwright/test').APIRequestContext) {
  await expect(panel.getByRole('heading', { name: 'Pair with your dashboard' })).toBeVisible();
  await panel.getByLabel('Server address').fill(api.base);
  const { code } = await apiJson(request, api, 'POST', '/api/pairing/code');
  await panel.getByLabel('Pairing code').fill(code);
  await panel.getByRole('button', { name: 'Pair extension' }).click();
  await expect(panel.getByRole('heading', { name: 'Capture a job' })).toBeVisible();
}

/** Same code path as clicking the toolbar icon, minus opening the side panel (needs a real gesture). */
async function captureFixture(name: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(fixtures.url(name));
  const sw = serviceWorker(context, extensionId);
  await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const hook = (globalThis as unknown as { __appfolio: { captureTab: (t: chrome.tabs.Tab) => Promise<unknown> } }).__appfolio;
    await hook.captureTab(tab);
  }, fixtures.url(name));
  return page;
}

test('pair, capture a page, review and save it as Saved', async ({ request }) => {
  const panel = await openPanel();
  await pair(panel, request);
  const pairings = await apiJson(request, api, 'GET', '/api/pairings');
  expect(pairings[0].origin).toBe(`chrome-extension://${extensionId}`);

  const page = await captureFixture('greenhouse.html');
  await expect(panel.getByRole('heading', { name: 'Review capture' })).toBeVisible();
  await expect(panel.getByLabel('Job title *')).toHaveValue('Robotics Software Engineer Co-op');
  await expect(panel.getByLabel('Company *')).toHaveValue('Northwind Robotics');
  const jd = panel.getByLabel('Job description text');
  await expect(jd).toHaveValue(/• Write quaternion calibration tooling/);
  await expect(jd).toHaveValue(/\$32–\$40 per hour/);
  expect(await jd.inputValue()).not.toContain('My private answer'); // form answers never captured
  expect(await jd.inputValue()).not.toMatch(/cookies/i);
  // The page itself is untouched by the capture.
  expect(await page.evaluate(() => document.querySelector('textarea')?.value)).toBe('My private answer');

  const save = panel.getByRole('button', { name: 'Save as Saved' });
  await expect(save).toBeDisabled(); // review confirmation required
  await panel.getByLabel('I reviewed this text').check();
  await save.click();
  await expect(panel.getByText('Saved to dashboard.')).toBeVisible();
  await expect(panel.getByText('New application created (status: Saved).')).toBeVisible();

  const apps = await apiJson(request, api, 'GET', '/api/applications');
  expect(apps).toHaveLength(1);
  const detail = await apiJson(request, api, 'GET', `/api/applications/${apps[0].id}`);
  expect(detail.status).toBe('saved');
  expect(detail.primarySnapshot.reviewedText).toContain('quaternion calibration');
  expect(detail.primarySnapshot.method).toBe('generic_dom');
  expect(detail.links[0].url).toBe(fixtures.url('greenhouse.html'));

  // Capturing the same page again offers to link instead of silently duplicating.
  await captureFixture('greenhouse.html');
  await expect(panel.getByText('Already saved?')).toBeVisible();
});

test('NUworks-style discovery page, then link the external application form to the same record', async ({ request }) => {
  const panel = await openPanel();
  await pair(panel, request);
  // Tell the extension which host is "NUworks" (we never guess it).
  await panel.getByRole('button', { name: 'Extension settings' }).click();
  await panel.getByLabel('NUworks hostnames').fill('127.0.0.1');
  await panel.getByRole('button', { name: 'Save hostnames' }).click();

  await captureFixture('job-board-generic.html');
  await expect(panel.getByLabel('Job title *')).toHaveValue('Software Engineer Co-op');
  await expect(panel.getByLabel('Found on')).toHaveValue('nuworks');
  await expect(panel.getByLabel('Job description text')).toHaveValue(/Apply directly at https:\/\/northwind\.wd1\.myworkdayjobs\.com/);
  await panel.getByLabel('Company *').fill('Northwind Robotics');
  await panel.getByLabel('I reviewed this text').check();
  await panel.getByRole('button', { name: 'Save as Saved' }).click();
  await expect(panel.getByText('Saved to dashboard.')).toBeVisible();
  await panel.getByRole('button', { name: 'Dismiss' }).click();

  // On the company's application form (no JD), link it to the existing record.
  await captureFixture('workday-form.html');
  await panel.getByRole('radio', { name: 'Link to existing application' }).click();
  await panel.getByLabel('Search your applications').fill('Software Engineer');
  await panel.getByRole('button', { name: /Software Engineer Co-op · Northwind Robotics/ }).click();
  await panel.getByLabel('Platform of this page').selectOption('workday');
  await expect(panel.getByLabel(/Save this page’s description/)).not.toBeChecked(); // form-only page
  await expect(panel.getByLabel('Job description text')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Link URL only' }).click();
  await expect(panel.getByText('This page was linked to the existing application.')).toBeVisible();

  const apps = await apiJson(request, api, 'GET', '/api/applications');
  expect(apps).toHaveLength(1);
  const d = await apiJson(request, api, 'GET', `/api/applications/${apps[0].id}`);
  expect(d.foundOn).toBe('nuworks');
  expect(d.appliedThrough).toBe('workday');
  expect(d.status).toBe('saved');
  expect(d.links.map((l: { relationship: string }) => l.relationship)).toEqual(['discovery', 'application']);
  expect(d.snapshots).toHaveLength(1);
});

test('offline capture is queued, survives a browser restart, and syncs exactly once', async ({ request }) => {
  let panel = await openPanel();
  await pair(panel, request);
  await api.stop();

  await captureFixture('company-jsonld.html');
  await expect(panel.getByLabel('Job title *')).toHaveValue('Lab Automation Engineer Co-op');
  await expect(panel.getByLabel('Company *')).toHaveValue('Contoso Bio');
  await panel.getByLabel('I reviewed this text').check();
  await panel.getByRole('button', { name: /Save/ }).click();
  await expect(panel.getByText('Queued — not in your dashboard yet.')).toBeVisible();
  await expect(panel.getByText('Saved to dashboard.')).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Waiting to sync (1)' })).toBeVisible();

  // Restart the browser: the queued capture must still be there.
  await context.close();
  ({ context, extensionId } = await launchWithExtension(profile));
  panel = await openPanel();
  await expect(panel.getByRole('heading', { name: 'Waiting to sync (1)' })).toBeVisible();

  // Bring the server back: the panel retries and the item is acknowledged.
  api = await startApi(dataDir, API_PORT);
  await expect(panel.getByRole('heading', { name: /Waiting to sync/ })).toHaveCount(0, { timeout: 30_000 });

  // Extra retries (e.g. an alarm firing late) don't duplicate anything.
  const sw = serviceWorker(context, extensionId);
  await sw.evaluate(() => (globalThis as unknown as { __appfolio: { flushQueue: () => Promise<void> } }).__appfolio.flushQueue());
  const apps = await apiJson(request, api, 'GET', '/api/applications');
  expect(apps).toHaveLength(1);
  expect(apps[0].company).toBe('Contoso Bio');
  const d = await apiJson(request, api, 'GET', `/api/applications/${apps[0].id}`);
  expect(d.primarySnapshot.reviewedText).toContain('Maintain pipetting calibration logs.');
});

test('unpaired or reset extension cannot write, and says so', async ({ request }) => {
  const panel = await openPanel();
  await pair(panel, request);
  await apiJson(request, api, 'DELETE', '/api/pairings/all');
  await captureFixture('short.html');
  await expect(panel.getByLabel('Job description text')).toHaveValue(/Weekend shifts/);
  await expect(panel.getByText(/Only \d+ characters were captured/)).toBeVisible(); // warned, not fabricated
  await panel.getByLabel('Company *').fill('Harbor Cafe');
  await panel.getByLabel('I reviewed this text').check();
  await panel.getByRole('button', { name: /Save/ }).click();
  await expect(panel.getByText('Queued — not in your dashboard yet.')).toBeVisible();
  await expect(panel.getByText(/not paired|pairing was reset/i).first()).toBeVisible();
  expect(await apiJson(request, api, 'GET', '/api/applications')).toHaveLength(0);
});
