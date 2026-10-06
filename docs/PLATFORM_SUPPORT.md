# Platform support

Extraction order: **platform adapter → JobPosting structured data → generic page content →
your selected text → manual paste**. Every capture is reviewed before saving, and the side
panel shows which method was used and the adapter's support level.

## Support levels (as of 2026-10-06)

| Platform | Level | What was actually checked |
|---|---|---|
| **Greenhouse** (`*.greenhouse.io`) | **Verified on real public pages** | `npm run verify:live` in Chrome 150 on two live boards (job-boards.greenhouse.io: Anthropic, GitLab). The adapter matched; title, company, location, and job ID were filled; full text kept headings, bullets, qualifications, salary, and application notes. Also covered by a synthetic fixture test. |
| **Workday** (`*.myworkdayjobs.com`) | **Verified on real public pages** | Two live tenants (NVIDIA, Salesforce). The first run exposed a bug: the job content renders after load, so capture finished too early. Fixed by waiting (bounded) for the description element. After the fix, the adapter matched; title, location, and requisition ID were filled with structure intact. The company comes from structured data and may include a legal-entity name: review it. |
| **LinkedIn** (`linkedin.com/jobs/view/…`) | **Fixture-tested; public guest view verified** | The adapter matched one live **logged-out** job page. The **signed-in** job view (the one you normally use) has different markup and **was not verified**. The selectors cover known signed-in class names, and generic extraction is the fallback. |
| **Handshake** | **Generic fallback, unverified** | Requires sign-in. No platform selectors; generic extraction plus review. |
| **NUworks** | **Generic fallback, unverified** | Requires sign-in; the hostname isn't assumed. Add it under *Extension settings → NUworks hostnames* (or tick "Always treat … as NUworks" during review). A synthetic "unknown job board" fixture (not NUworks markup) tests the generic path, including external application instructions. |
| **Company career sites** | **Structured data + generic** | Fixture-tested (JobPosting JSON-LD, including entity-encoded HTML and multiple postings). |
| **Anything else** | **Manual** | *Paste manually* in the side panel or **Save a job** in the dashboard. |

Pages Chrome doesn't allow extensions to read (`chrome://`, the Web Store, the built-in PDF
viewer) always fall back to manual paste.

## What the tests prove, and what they don't

- **Unit tests** run the extractor on synthetic fixtures in jsdom.
- **E2E tests** run the real built extension in Google Chrome against those fixtures, served from `127.0.0.1`.
- **Not automated: clicking the toolbar icon.** Playwright can't press Chrome's toolbar button, so the
  tests call the same `captureTab()` the click handler calls. Injection on `127.0.0.1` is allowed by the
  extension's loopback host permission. On real sites, access comes from `activeTab` at click time.
  Check the click path once by hand (below).
- **Not automated: notification delivery.** Chrome's optional-permission prompt can't be accepted in
  headless automation. The scheduling logic (offsets, skip-past, missed collapse, reschedule keys) is
  unit-tested in `packages/shared/test/reminders.test.ts`.

## Manual checklist for signed-in sites

Use your own browser session. Never share passwords; the extension doesn't need them.

1. **Setup:** `npm start`, load `apps/extension/dist`, pair. Add your NUworks hostname in Extension settings.
2. **Toolbar click:** on any public job page, click the Appfolio icon. The side panel opens with a draft. Repeat with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>.
3. **NUworks:** open a posting with its full description. Capture.
   - Check: platform says NUworks; title and company are right (fix if not).
   - Check: the text includes duties, qualifications, pay, and application instructions.
   - Note any warnings, then save.
4. **External route:** follow the posting's external link. On the company page, capture → *Link to existing application* → pick the NUworks record.
   - If the page has a JD, keep the snapshot; if it's a form, choose *Link URL only*.
   - In the dashboard, check *Found on: NUworks → Applied through: …*.
5. **LinkedIn (signed in):** open a job in the jobs view, click "See more", capture.
   - Note whether the method says *Platform adapter* or *Page content (generic)*.
   - Check that the text is complete and has no "People also viewed" content.
6. **Handshake:** same as LinkedIn; it's expected to use *Page content (generic)*.
7. **Offline:** stop the server, capture and save. Expect *Queued — not in your dashboard yet*. Restart Chrome, start the server, open the side panel. The queue empties and exactly one record appears.
8. **Reminders:** enable them in Extension settings and allow the notification permission. Add an assessment due in about 2 hours 10 minutes with a 2-hour reminder. A notification should appear about 10 minutes later; clicking it opens the packet.
9. Record results (date, Chrome version, method used, any fixes) in the table above.

Signed-in markup changes often. If a platform starts falling back to generic extraction, the review
step still lets you fix or paste the text. To report a problem without sharing real content, save the
page's HTML locally under `tests/fixtures/real/` (ignored by Git) and run `npm run peek -- <file> <url>`.
