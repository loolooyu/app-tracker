# Appfolio — architecture plan & progress log

This file is the resumable progress document. Keep it current.

## Environment (inspected 2026-10-06)

- macOS 12.7.5 x86_64, Node 24.18.0, npm 11.16.0, Google Chrome 150.
- `node:sqlite` is available in Node 24 with FTS5 and the online `backup()` API, so
  no native SQLite module needs compiling.
- The reference prototype URL returns HTTP 401 (it's private), so the dashboard follows the written spec.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Package manager | npm workspaces, one lockfile | Already installed; no extra tooling |
| Language | TypeScript 5.9 | Mature tooling. TS 7 (the native port) is new, so it isn't pinned |
| API | Fastify 5 + Zod 4 schemas | Lightweight, has a good `inject()` for tests |
| DB | `node:sqlite` (built-in), SQL migrations in `apps/api/src/db/migrations.ts` | No native compile; supports the online backup API |
| Files | Content-hashed, generated storage keys under `<dataDir>/documents` | Immutable bytes; no filenames on disk |
| Zip | yazl (write) and yauzl (read; gives per-entry sizes before extraction) | Lets restore enforce size limits before extracting |
| Dashboard | React 19 + Vite 8, plain CSS with design tokens | No UI framework or external fonts |
| Extension | MV3, side panel (React) bundled with esbuild | Single-file content script and service worker |
| Tests | Vitest 5 (unit/integration, jsdom fixtures), Playwright 1.63 (dashboard + real unpacked extension in bundled Chromium) | |

### Capture invocation
`action.onClicked` (the toolbar icon or the `_execute_action` shortcut, Alt+Shift+S) grants `activeTab`.
The service worker calls `chrome.sidePanel.open()` synchronously, then injects the
capture script with `chrome.scripting.executeScript`. The draft goes to
`chrome.storage.local` and doesn't depend on the tab. We don't use `openPanelOnActionClick`,
because Chrome's docs don't say that it grants activeTab.

### Security model (local-only)
- The API binds to 127.0.0.1 only. The Host header must be `127.0.0.1:<port>` or `localhost:<port>`
  (this blocks DNS rebinding).
- Dashboard: same-origin, served by the API. Mutating requests need an allowed `Origin`
  plus a custom `X-Appfolio-Client` header. Any request with `Sec-Fetch-Site: cross-site`/`same-site` is rejected
  unless it's an authenticated extension request.
- Extension: one-time pairing code (shown in the dashboard, 10-minute expiry), exchanged for a
  random 256-bit bearer token bound to that `chrome-extension://<id>` origin. Only token
  hashes are stored, in `<dataDir>/auth.json` (0600), which is never in backups.
- Captured content is treated as untrusted plain text and is never rendered as HTML.

## Checklist

- [x] Phase 1: inspect environment, pick versions, plan, scaffold
- [x] Phase 2: DB, migrations, CRUD, snapshots, links, documents, activity
- [x] Phase 3: blue dashboard
- [x] Phase 4: extension (pairing, capture, review, queue, linking)
- [x] Phase 5: assessments, reminders, ICS
- [x] Phase 6: backup and restore, hardening
- [x] Phase 7: tests, builds, docs, final report

## Commands

See README.md.

## Progress notes
- All phases complete (2026-10-06).
- `npm run test:all` → typecheck, 78 Vitest tests (shared + API), production build, 12 Playwright tests (8 dashboard + 4 on the real unpacked extension in Google Chrome 150).
- Playwright's bundled Chromium doesn't support macOS 12, so e2e uses `channel: 'chrome'`. The extension is loaded with CDP `Extensions.loadUnpacked` (`--enable-unsafe-extension-debugging`), because branded Chrome dropped `--load-extension`.
- Live verification (public pages, `npm run verify:live`): Greenhouse ×2 and Workday ×2 verified. The LinkedIn guest view matched. Signed-in LinkedIn, Handshake, and NUworks are unverified (see PLATFORM_SUPPORT.md).
- Bug found by live verification and fixed: Workday renders the JD after load. Capture now waits (bounded) for each adapter's `readySelector`.

## Known gaps
- The toolbar-click → activeTab path and notification delivery can't be automated; there are manual checklist items for them.
- Signed-in platform markup is unverified.
