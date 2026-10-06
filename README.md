# Appfolio

**Every application, remembered.** A local-first job application tracker that keeps, for every
application, the job description as you saw it and the exact resume you sent, whatever site
you found it on or applied through.

- **Chrome extension:** click it on a job page (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>), review what it read, and save.
- **Dashboard:** search every saved job description, see each application's packet (JD, submitted resume, route, OA/HireVue deadlines, interviews, notes, history), and manage resume versions.
- **Local server:** a SQLite database and your original files in a private folder on your computer. It isn't on the internet, there's no account, and no AI service is involved.

> Everything runs on `127.0.0.1`. Nothing is uploaded anywhere. Don't deploy this server publicly: it holds your resumes.

---

## 1. Prerequisites

- **Node.js 24** or newer (tested on 24.18). Check with `node -v`.
- **npm** (comes with Node).
- **Google Chrome 116+** for the extension (tested on Chrome 150, macOS 12).

## 2. Install and start

```bash
npm install
npm run build      # builds the dashboard, the API, and the extension
npm start          # serves everything at http://127.0.0.1:4317
```

Open **http://127.0.0.1:4317**. Stop with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

Options (flags or environment variables):

| Setting | Flag | Env var | Default |
|---|---|---|---|
| Data directory | `--data-dir <path>` | `APPFOLIO_DATA_DIR` | see below |
| Port | `--port <n>` | `APPFOLIO_PORT` | `4317` |
| Max upload size (MB) | | `APPFOLIO_MAX_UPLOAD_MB` | `20` |
| Max restore archive (MB) | | `APPFOLIO_MAX_RESTORE_MB` | `2048` |
| Log level | | `APPFOLIO_LOG_LEVEL` | `warn` (`info` logs every request, method and path only) |

Development mode (Vite hot reload plus the API with auto-restart):

```bash
npm run dev        # dashboard at http://localhost:5173, API on 127.0.0.1:4317
```

In dev mode the API also accepts the Vite origin `http://localhost:5173` (override with
`APPFOLIO_DEV_ORIGINS`). Vite proxies `/api` to the API.

## 3. Where your data lives

| OS | Default data directory |
|---|---|
| macOS | `~/Library/Application Support/Appfolio` |
| Windows | `%APPDATA%\Appfolio` |
| Linux | `$XDG_DATA_HOME/appfolio` or `~/.local/share/appfolio` |

Inside it (folders `0700`, files `0600`):

- `appfolio.db`: the SQLite database (records, saved JDs, links, deadlines, history)
- `documents/`: your uploaded files, byte-for-byte, under generated names
- `auth.json`: hashes of extension pairing tokens (never included in backups)
- `backups/`: recovery backups created before a "replace workspace" restore
- `orphaned/`: files left by an interrupted upload, moved aside at startup (safe to delete)

The **Settings & Backup** page shows the exact path.

## 4. Install the extension

1. Run `npm run build` (this creates `apps/extension/dist`).
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `apps/extension/dist` folder.
4. Optional: pin **Appfolio Capture** from the puzzle-piece menu so the icon is always visible.

To check or change the shortcut, go to `chrome://extensions/shortcuts`. The default is
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (<kbd>⌥</kbd><kbd>⇧</kbd><kbd>S</kbd> on Mac).

After you change the code, run `npm run build -w @appfolio/extension` and click the reload icon on the extension card.

## 5. Pair the extension

1. With `npm start` running, open the dashboard → **Settings & Backup** → **Generate pairing code**.
2. Click the Appfolio icon in Chrome. The side panel asks for a code: paste it and click **Pair extension**.
   The server address defaults to `http://127.0.0.1:4317`; change it if you used `--port`.

The code expires in 10 minutes and works once. The extension then holds its own random key, stored
only in the extension's local storage. That key can save and link jobs and read deadlines. It can't
read your documents, delete records, or make backups.

- **Unpair / reset:** Settings & Backup → *Unpair* (one browser) or *Reset all pairings*. In the extension: Extension settings → *Unpair this browser*.
- **Reinstalled the unpacked extension?** Its ID may change. Pair again; each extension ID gets its own pairing.

## 6. Everyday use

**A. Capture before applying.** Open the full job description (expand any "See more" first). Click the
Appfolio icon (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>). The side panel shows the company,
title, location, platform, URL, job ID, and the full description. It also warns about short captures,
pages that were still loading, collapsed sections, or several jobs on one page. Edit anything, switch to
another extraction (structured data / page content / your selected text), or paste. Then tick *I reviewed
this text* and click **Save as Saved**.

- "Saved to dashboard" appears only after the server confirms the save.
- If the server is offline, the panel says **Queued — not in your dashboard yet**. The capture is kept in
  the extension (it survives a browser restart) and is sent automatically. It can't create a duplicate.

**B. NUworks → company site.** Save the JD on NUworks. Follow the posting's external link yourself. On the
company page, click Appfolio again, choose **Link to existing application**, pick the record, and save.
- If that page has its own JD, it's saved as a separate dated snapshot.
- If it's only a form, uncheck the snapshot and choose **Link URL only**.

The record keeps both routes: *Found on: NUworks* and *Applied through: Workday*. To label NUworks pages
automatically, add its hostname under the side panel's *Extension settings*. Appfolio never guesses it.

**C. Mark applied.** After you've actually submitted, open the packet, click **Mark applied**, set the
submission time, and pick (or upload) the **exact** resume you sent. Nothing is preselected. You can
skip the resume; the record then shows **Resume needed** until you choose one.

**D. OA / HireVue / interviews.** In the packet, use **Add OA / HireVue**. Enter the deadline's date, time,
and the time zone the company gave you. Upcoming and overdue tasks appear in **OA & HireVue up next**.
Check a task off when it's done. Each one has a **.ics** calendar export.

**E. The posting disappeared.** Open the packet → **Read full JD**. It reads your saved copy, never the
live site. **Open original posting** is a separate link and may fail.

**No extension, or a site it can't read?** Use **Save a job** in the dashboard and paste.

### Browser reminders (optional)

In the side panel → *Extension settings* → **OA/HireVue browser reminders** (Chrome asks for notification
permission). Defaults are 24 hours and 2 hours before the deadline; change them per task or in Settings.

- Reminders need Chrome running and OS notifications allowed. If Chrome is closed or the computer is
  asleep, they can't arrive on time. You get one catch-up notice later if the deadline hasn't passed.
- Reminders that were already in the past when you added a task are skipped.
- The dashboard's due list is always the source of truth.

## 7. Backup and restore

- **Settings & Backup → Download full backup:** a `.zip` with all records, saved JDs, links, history, and
  your original files, plus a manifest of SHA-256 hashes. It contains personal documents, so keep it private.
  Pairing keys are not included.
- **Download CSV:** a spreadsheet overview. It is **not** a backup (no JD text, no files).
- **Restore:** choose a backup. It's validated first (paths, sizes, hashes, references, schema version) and
  you see a summary. Into an empty workspace, it applies directly. Into a non-empty one, you must type
  `REPLACE`, and a recovery backup of the current workspace is saved to `<data dir>/backups/` first.
  Merging is not supported.

Details: [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md).

## 8. Demo data

On an empty workspace, **Settings & Backup → Load demo data** adds clearly fictional records (marked
"Demo") and **Remove demo data** deletes them. Or run `npm run demo`, which uses a separate `./.demo-data` directory.

## 9. Tests

```bash
npm run typecheck
npm test               # unit + API integration tests (Vitest)
npm run build
npm run test:e2e       # browser tests in your installed Google Chrome (Playwright)
npm run test:all       # all of the above
```

The e2e suite drives the dashboard and the **real unpacked extension** in Google Chrome (loaded
via the DevTools protocol, since branded Chrome no longer accepts `--load-extension`). It uses
synthetic fixture pages. To check extraction on a real public posting:

```bash
npm run verify:live -- https://job-boards.greenhouse.io/<company>/jobs/<id>
```

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard says "Can't reach the local Appfolio server" | Run `npm start` in the project folder. The page reconnects by itself. |
| `Port 4317 is already in use` | Appfolio is already running, or use `--port 4400` (and set the same address in the extension). |
| "The dashboard has not been built" | Run `npm run build`. |
| Extension: "isn't paired" / captures stay queued with a pairing message | Pair again (section 5). Queued captures send after pairing. |
| Extension: "no longer has access to this tab" | Chrome revokes access when you navigate away. Click the toolbar icon on the page again. |
| Extension can't read the page (chrome://, Web Store, PDF viewer) | Chrome blocks extensions there. Use **Paste manually**. |
| Captured text is short or missing sections | Expand "See more" on the page and recapture, select the description and recapture, or paste. |
| A resume can't be deleted | It's the submitted file for some application. The dialog lists which; assign a different file there first. |
| Restore rejected | The message names the problem (for example, a newer schema needs a newer Appfolio). Your current data is untouched. |
| No reminder notifications | Enable them in the extension, allow Chrome notifications in your OS, and keep Chrome running. Check "Reminder sync" on **Your Workflow**. |

## More documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data model, security model, decisions
- [docs/PLATFORM_SUPPORT.md](docs/PLATFORM_SUPPORT.md): what's verified per job site, plus a manual test checklist
- [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md): archive format, consistency, recovery
- [docs/PLAN.md](docs/PLAN.md): build log and decisions
- [docs/FUTURE.md](docs/FUTURE.md): deliberately out of scope for v1
