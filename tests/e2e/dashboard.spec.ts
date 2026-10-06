import { expect, test, type Page } from '@playwright/test';
import { apiJson, cleanup, pdfBytes, startApi, tempDir, type Api } from './helpers';

let api: Api;
let dataDir: string;

test.beforeEach(async () => {
  dataDir = tempDir('appfolio-e2e-dash-');
  api = await startApi(dataDir, 4418);
});
test.afterEach(async () => {
  await api.stop();
  cleanup(dataDir);
});

const JD = `About the role

Join the controls team for a six-month co-op.

Responsibilities

• Tune PID loops for the warehouse fleet.
• Write zeppelin telemetry dashboards.

Qualifications

• Coursework in control systems.

Pay: $31 per hour. Apply on the company site.`;

async function saveManually(page: Page, opts: { company: string; title: string; url?: string; text?: string }) {
  await page.getByRole('button', { name: 'Save a job' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Save a job' });
  await dialog.getByLabel('Company *').fill(opts.company);
  await dialog.getByLabel('Job title *').fill(opts.title);
  if (opts.url) await dialog.getByLabel('Posting URL').fill(opts.url);
  if (opts.text) {
    await dialog.getByLabel('Job description', { exact: true }).fill(opts.text);
    await dialog.getByLabel('I reviewed this text').check();
  }
  await dialog.getByRole('button', { name: /^Save (job|as a separate application)$/ }).click();
  await expect(dialog).toBeHidden();
}

test('manual capture → saved JD readable even though the source is unreachable', async ({ page }) => {
  await page.goto(api.base);
  await expect(page.getByRole('heading', { name: 'Every application, remembered.' })).toBeVisible();
  await expect(page.getByText('Start your first application packet')).toBeVisible(); // onboarding state

  // The posting URL points at a closed local port: it can never be fetched.
  await saveManually(page, { company: 'Northwind Robotics', title: 'Controls Co-op', url: 'http://127.0.0.1:9/postings/expired-123', text: JD });

  const packet = page.getByRole('article');
  await expect(packet.getByRole('heading', { name: 'Controls Co-op' })).toBeVisible();
  await expect(packet.locator('.badge.st-saved')).toHaveText('Saved');
  await expect(page.locator('.stat').filter({ hasText: 'Applications' }).locator('.stat-value')).toHaveText('0');
  await expect(page.locator('.stat').filter({ hasText: 'JDs preserved' }).locator('.stat-value')).toHaveText('1');

  // Opening the original posting doesn't change status.
  const [popup] = await Promise.all([page.waitForEvent('popup'), packet.getByRole('link', { name: /Open original posting/ }).click()]);
  await popup.close();
  await page.reload();
  await expect(page.getByRole('article').locator('.badge.st-saved')).toHaveText('Saved');

  // Read the full saved JD from the local archive.
  await page.getByRole('button', { name: 'Read full JD' }).click();
  const reader = page.getByRole('dialog');
  await expect(reader.getByLabel('Job description text')).toContainText('Write zeppelin telemetry dashboards.');
  await expect(reader.getByLabel('Job description text')).toContainText('Pay: $31 per hour.');
  await page.keyboard.press('Escape');
  await expect(reader).toBeHidden();
  await expect(page.getByRole('button', { name: 'Read full JD' })).toBeFocused(); // focus restored
});

test('mark applied with an uploaded resume; downloaded bytes match exactly', async ({ page, request }) => {
  await page.goto(api.base);
  await saveManually(page, { company: 'Harborview Analytics', title: 'Data Analyst Co-op', text: JD });
  await page.getByRole('button', { name: 'Mark applied' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark applied' });
  await expect(dialog.getByRole('button', { name: 'Mark applied without resume' })).toBeVisible(); // never preselects a resume
  const bytes = pdfBytes('e2e-resume-v7');
  await dialog.getByLabel('Label for the new resume (optional)').fill('Analytics v7');
  await dialog.getByLabel('Upload resume file (PDF or DOCX)').setInputFiles({ name: 'Resume.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(dialog.getByText('Uploaded “Analytics v7”.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Mark applied', exact: true }).click();
  await expect(dialog).toBeHidden();

  const packet = page.getByRole('article');
  await expect(packet.locator('.badge.st-applied').first()).toHaveText('Applied');
  await expect(packet.locator('.doc-card').getByText('Analytics v7', { exact: true })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: 'Applications' }).locator('.stat-value')).toHaveText('1');

  const [download] = await Promise.all([page.waitForEvent('download'), packet.getByRole('link', { name: 'Download', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('Resume.pdf');
  const { readFileSync } = await import('node:fs');
  expect(Buffer.compare(readFileSync(await download.path()), bytes)).toBe(0);

  // Same check against the API after a restart.
  await api.stop();
  api = await startApi(dataDir, 4418);
  const docs = await apiJson(request, api, 'GET', '/api/documents');
  const file = await request.get(`${api.base}/api/documents/${docs[0].id}/file`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  expect(Buffer.compare(await file.body(), bytes)).toBe(0);
});

test('missing resume warning, then choosing the version clears it', async ({ page }) => {
  await page.goto(api.base);
  await saveManually(page, { company: 'Lumen Health Labs', title: 'Design Intern' });
  await page.getByRole('button', { name: 'Mark applied' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark applied without resume' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resume needed' })).toBeVisible();
  await expect(page.locator('.list-row').getByText('Resume needed')).toBeVisible();
  await page.getByRole('alert').getByRole('button', { name: 'Choose resume' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Upload resume file (PDF or DOCX)').setInputFiles({ name: 'Design.pdf', mimeType: 'application/pdf', buffer: pdfBytes('design') });
  await expect(dialog.getByText(/Uploaded/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save resume' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Resume needed' })).toHaveCount(0);
  await expect(page.getByText('Submitted resume recorded: “Design”')).toBeVisible();
});

test('search finds a term only present in the saved JD; filters by platform', async ({ page }) => {
  await page.goto(api.base);
  await saveManually(page, { company: 'Northwind', title: 'Controls Co-op', url: 'https://www.linkedin.com/jobs/view/3900000001/', text: JD });
  await saveManually(page, { company: 'Contoso', title: 'Lab Co-op', url: 'https://careers.contoso.test/1' });
  await page.goto(api.base + '/#/applications');
  await page.getByLabel('Search applications and saved job descriptions').fill('zeppelin');
  const rows = page.locator('.list-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Matched in saved JD');
  await expect(rows.first().locator('.snippet')).toContainText('zeppelin telemetry');
  await page.getByLabel('Search applications and saved job descriptions').fill('nothing-matches-this');
  await expect(page.getByText('No matching applications')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await page.getByLabel('Source platform').selectOption('linkedin');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Controls Co-op');
});

test('assessment with explicit time zone appears up next and completing it clears it', async ({ page }) => {
  await page.goto(api.base);
  await saveManually(page, { company: 'Harborview', title: 'Analyst', text: JD });
  await page.getByRole('button', { name: 'Add OA / HireVue' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add OA / HireVue' });
  await dialog.getByLabel('Type').selectOption('hirevue');
  const future = new Date(Date.now() + 3 * 86400_000);
  const date = future.toISOString().slice(0, 10);
  await dialog.getByLabel('Date').fill(date);
  await expect(dialog.getByText('Add a time. A date alone is ambiguous for a deadline.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add assessment' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Use 11:59 PM' }).click();
  await dialog.getByLabel('Time zone').selectOption('America/Los_Angeles');
  await expect(dialog.getByText(/in your time zone/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add assessment' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('heading', { name: 'OA & HireVue up next' })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: 'Assessments due' }).locator('.stat-value')).toHaveText('1');
  await expect(page.getByRole('article').locator('.badge.st-assessment').first()).toHaveText('OA/HireVue'); // status advanced (checkbox default)
  await page.getByRole('checkbox', { name: /Mark “HireVue” complete/ }).click();
  await expect(page.getByRole('checkbox', { name: /Mark “HireVue” not done/ })).toBeChecked();
  await expect(page.locator('.stat').filter({ hasText: 'Assessments due' }).locator('.stat-value')).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'OA & HireVue up next' })).toHaveCount(0);
});

test('captured script/HTML is rendered as inert text', async ({ page }) => {
  await page.goto(api.base);
  const hostile = 'Responsibilities <img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script> Qualifications: none';
  await saveManually(page, { company: 'Fabrikam', title: 'Security Intern', text: hostile });
  await expect(page.locator('.jd-preview')).toContainText('<img src=x onerror="window.__pwned=1">');
  await page.getByRole('button', { name: 'Read full JD' }).click();
  await expect(page.getByLabel('Job description text')).toContainText('<script>window.__pwned=2</script>');
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  expect(await page.locator('.jd-full img, .jd-preview img, .jd-full script').count()).toBe(0);
});

test('narrow screen: list and packet stack without horizontal scrolling', async ({ page, request }) => {
  await apiJson(request, api, 'POST', '/api/demo', { timezone: 'America/New_York' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(api.base);
  await expect(page.getByText('Demo workspace.')).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.locator('.list-row').filter({ hasText: 'Robotics Software Engineer Co-op' }).click();
  await expect(page.getByRole('article').getByRole('heading', { name: 'Robotics Software Engineer Co-op' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All applications' })).toBeVisible();
  await expect(page.locator('.list-panel')).toBeHidden();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Read full JD' }).click();
  await expect(page.getByLabel('Job description text')).toContainText('quaternion calibration');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'All applications' }).click();
  await expect(page.locator('.list-panel')).toBeVisible();
});

test('shows a clear error when the local server goes offline', async ({ page }) => {
  await page.goto(api.base);
  await expect(page.getByText('Local server connected')).toBeVisible();
  await api.stop();
  await page.getByRole('button', { name: 'Save a job' }).first().click().catch(() => undefined);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Can’t reach the local Appfolio server.')).toBeVisible({ timeout: 20_000 });
  api = await startApi(dataDir, 4418);
});
