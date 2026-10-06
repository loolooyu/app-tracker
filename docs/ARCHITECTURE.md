# Architecture

```
┌──────────── Chrome ────────────┐        ┌──────── Local API (127.0.0.1:4317) ────────┐
│ Job page                       │        │ Fastify + Zod                              │
│   ▲ capture.js (isolated world,│        │  ├─ request guard (Host/Origin/token)      │
│   │ injected on click only)    │        │  ├─ store/* (SQL, transactions, activity)  │
│ Service worker ── fetch ───────┼──────▶ │  ├─ FileStore (staged, hashed, immutable)  │
│   queue · alarms · reminders   │ token  │  └─ backup / restore                        │
│ Side panel (React) ─ messages ─┘        │ SQLite (node:sqlite, WAL)  documents/       │
│                                         │ serves the built dashboard (same origin)    │
│ Dashboard (React) ── same-origin fetch ─▶                                             │
└─────────────────────────────────────────┴─────────────────────────────────────────────┘
```

## Packages

| Path | What |
|---|---|
| `packages/shared` | Constants, Zod schemas, API types, URL normalization, platform detection, time-zone math, match scoring, reminder planning, and **extraction** (`extract/`, DOM to text, adapters, JSON-LD, generic scoring, warnings). Runs in the browser, the extension, and Node (jsdom tests). |
| `apps/api` | Fastify server, migrations, data layer (`store/`), file storage, auth, backup/restore. Bundled with esbuild into `dist/main.js`. |
| `apps/web` | Dashboard (React 19 + Vite 8). Plain CSS with design tokens; system fonts only. |
| `apps/extension` | MV3 extension: `background.ts` (service worker), `capture.ts` (content script), `sidepanel/` (React). Built with esbuild into `dist/`. |
| `tests/fixtures/pages` | Synthetic, fictional job pages used by unit and e2e tests. |
| `tests/e2e` | Playwright tests for the dashboard and the real extension. |

## Data model (migration 1)

- **applications**: company, title, location, job type, program, season, job ID, `found_on`, `applied_through`, status (`saved`, `applied`, `assessment`, `interview`, `offer`, `rejected`, `withdrawn`), notes, tags, `archived`, `is_demo`, `submitted_at`, `primary_snapshot_id`, `submitted_resume_document_id`, `submitted_cover_letter_document_id`, timestamps. Archiving is independent of status.
- **source_links**: original URL (kept verbatim), normalized URL (matching only), platform, relationship (`discovery` / `application` / `additional`), job ID. Unique per (application, normalized URL).
- **jd_snapshots**: raw captured text and reviewed text (both kept), method, warnings, review-confirmation time, SHA-256 of reviewed text, page title, capture ID. **A trigger makes the content columns immutable**; corrections add a new snapshot. Identical text for the same application is reused, not duplicated.
- **documents**: type, label, original filename, MIME type, byte size, SHA-256 (unique), generated storage key. **A trigger makes everything but the label immutable.** Referenced documents are protected by `ON DELETE RESTRICT` as well as an API check.
- **assessments**: type, title, URL, `due_at` (UTC ISO), `timezone` (IANA, as entered), `completed_at`, reminder offsets, notes.
- **interviews**: title, `starts_at` + timezone, format, notes.
- **activity**: application, type, time, and small JSON data holding references only (IDs, platform names, timestamps). Never document bytes or JD text.
- **capture_requests**: capture ID → result. Makes captures idempotent, and is included in backups so retries after a restore are still recognized.
- **settings**: display time-zone override, default reminder offsets.

Summary definitions (also shown as tooltips on the cards):

- *Applications*: non-archived records with `submitted_at`.
- *Interviews*: non-archived records whose status is Interview.
- *Assessments due*: incomplete assessments with a due time in the future, on non-archived records. Overdue ones are counted separately.
- *JDs preserved*: non-archived applications with at least one snapshot.

"Resume needed" means no submitted resume, and either a submission date or a status of Applied, OA/HireVue, Interview, or Offer.

## Key invariants and where they're enforced

| Invariant | Enforcement |
|---|---|
| Saving a capture never sets Applied | `processCapture` always creates `saved`; only `markApplied` / explicit status changes move it |
| Opening links never changes status | Links are plain `<a target=_blank>`; no API call |
| Snapshots and documents are immutable | SQLite triggers + no update endpoints |
| Resume selection is never invented | Pickers default to "none"; the API takes only explicit IDs |
| Similar records are never merged | `findMatches` returns suggestions; merging requires the user to pick "Link" |
| Retries don't duplicate | Client-generated capture UUID + `capture_requests` table, checked inside the same transaction |
| No dangling file references | Bytes are staged and hashed, moved into place, then the row is inserted; on failure the file is removed. A startup sweep quarantines unreferenced files and reports missing ones |
| Saved JD never needs the network | The reader and `.txt` download read the snapshot only |

## Security model

The threat model is other websites in your browser, other extensions, and DNS rebinding.
It does not cover malware running as your user, which could read the data directory anyway.

- **Loopback only.** The server binds `127.0.0.1`. Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defense), else `421`.
- **Dashboard requests** are same-origin (the API serves the dashboard).
  - Any request with `Sec-Fetch-Site: cross-site|same-site` is refused.
  - An `Origin`, if present, must be the dashboard's own origin (or a configured dev origin).
  - Writes additionally require an allowed `Origin` and the custom header `X-Appfolio-Client: dashboard`.
  - Security doesn't rely on CORS: no CORS headers are sent at all.
- **Extension requests** use `Authorization: Bearer <token>`.
  - The token is 256 random bits from a one-time 8-character pairing code (10-minute expiry, 5 wrong guesses invalidate it).
  - It's bound to the `chrome-extension://<id>` origin that redeemed it.
  - Only SHA-256 hashes are stored, in `auth.json` (0600).
  - Extension tokens are restricted to an allowlist of routes: health, session, captures, match, list/search applications, reminder schedule, heartbeat.
- **Extension internals.**
  - The capture script runs only after the toolbar click or shortcut (`activeTab`). It runs in the isolated world and returns plain data via `executeScript`.
  - The service worker accepts messages only from the extension's own pages, with a fixed set of message types.
  - There is no `externally_connectable`, no web-accessible resources, and no generic fetch proxy. The API base must be a loopback origin.
  - Host permissions are limited to `http://127.0.0.1/*` and `http://localhost/*` (to reach the API). `notifications` is optional and requested only when you turn reminders on.
- **Files.** Type is detected from bytes (`%PDF-`, or a ZIP containing `word/document.xml`), not the extension. Storage keys are random. Downloads send `Content-Disposition` with the original filename (RFC 6266), `nosniff`, and `no-store`; only PDFs are offered inline.
- **Captured content is data.** It's stored and rendered as plain text (React text nodes, `white-space: pre-wrap`). It's never interpreted as HTML or as instructions. The dashboard is served with a strict CSP (`script-src 'self'`).
- **Logs** contain method, path, and status only, never bodies, query strings, or headers.

## Notable decisions

- **`node:sqlite`** (built into Node 24, with FTS5 and the online backup API) instead of a native module, so nothing needs compiling.
- **Search uses `LIKE` across fields and snapshot text** rather than FTS5. Substring matching is more forgiving for a few hundred to a few thousand records, and stays exact under immutable snapshots. Wildcards are escaped.
- **Capture invocation** uses `action.onClicked` (which grants `activeTab`) and then opens the side panel inside the gesture. `openPanelOnActionClick` is not documented to grant `activeTab`.
- **Drafts** are stored per key in `chrome.storage.local`, independent of the tab. A new capture never overwrites an existing draft. The service worker owns the queue; the panel edits drafts.
- **Reminders.** Definitions live in the API. The extension caches only assessment ID, application ID, title, company, due time, zone, offsets, and completion state, then reconciles `chrome.alarms` on install, startup, pairing, every 15 minutes, after a queue flush, and on demand. Delivered and skipped keys are tracked; missed reminders collapse into one notice. Alarms are recreated on startup because Chrome only guarantees persistence across sessions from Chrome 150 (`persistAcrossSessions`).
- **Time zones** use only `Intl`. Nonexistent (spring-forward) times move forward and the UI says so; ambiguous (fall-back) times take the first occurrence and the UI says so.
