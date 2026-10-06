# Backup and restore

## Archive format (format version 1)

```
manifest.json               format, formatVersion, schemaVersion, appVersion, createdAt, notice,
                            counts, records[{path, table, rows, size, sha256}],
                            files[{path, documentId, storageKey, size, sha256}]
records/<table>.json        {"table", "schemaVersion", "rows": [...]} for settings, documents,
                            applications, source_links, jd_snapshots, assessments, interviews,
                            activity, capture_requests
documents/<storageKey>      original file bytes, stored uncompressed
```

**Excluded:** `auth.json` (pairing token hashes). A restore keeps the current workspace's pairings.

The archive contains your resumes, cover letters, and saved job descriptions. Store it like any private document.

## Consistency while the app is running

1. The database is copied with **SQLite's online backup API** (`node:sqlite` `backup()`). This yields a
   consistent point-in-time snapshot even during concurrent writes. All records are read from that snapshot.
2. Document bytes are immutable and live under unique keys. While a backup runs, physical file deletion is
   **deferred**, so every file the snapshot references stays readable until the backup finishes.
3. Each file is re-hashed while the archive is written and must match its recorded SHA-256 and size;
   otherwise the backup fails rather than producing a silently incomplete archive.

## Restore: validation happens before anything changes

Upload: **Settings & Backup → Restore**. Staging:

1. The upload is streamed to the data directory's `tmp/`, limited by `APPFOLIO_MAX_RESTORE_MB` (default 2 GB).
2. Every entry name is checked. Rejected: `..`, absolute paths, backslashes, drive letters, and anything
   other than `manifest.json`, `records/<table>.json`, or `documents/<32 hex>`. Duplicates, encrypted
   entries, oversize entries, and suspicious compression ratios (>200:1 on >1 MB) are rejected, and total
   expanded size is capped. yauzl also validates names and actual vs. declared sizes during extraction.
3. The manifest is checked:
   - Known format.
   - `formatVersion` and `schemaVersion` not newer than this build. Error messages say to update Appfolio.
   - Every listed entry exists with a matching SHA-256 and size; unlisted files are rejected.
4. Records are imported into a **separate staged database** created at the backup's schema version.
   - Only known columns and scalar values are accepted.
   - `PRAGMA foreign_key_check` must be clean, and the database is migrated forward and integrity-checked.
   - Every document row must have its file with a matching hash and size.
5. You get a summary (counts, size, warnings). Nothing has changed yet.

Apply:

- **Empty workspace** (no applications or documents): applies directly.
- **Non-empty workspace**: you must type `REPLACE`. First a full **recovery backup** of the current
  workspace is written to `<data dir>/backups/recovery-before-restore-<time>.appfolio-backup.zip`.
- The swap is synchronous:
  1. Close the database.
  2. Move the current `appfolio.db` (+ WAL/SHM) and `documents/` into `restore-previous-<time>/`.
  3. Move the staged ones in and reopen.
  4. If any step fails, the moves are reversed and the old database is reopened.
  5. After success the `restore-previous-*` folder is removed; the recovery backup remains.

There is no merge import. Restoring always means "this workspace becomes the backup".

## Manual recovery (if the process dies mid-swap)

The swap only renames files within the data directory. If Appfolio was killed during a restore:

1. Stop Appfolio.
2. If `restore-previous-<time>/` exists in the data directory, it holds the previous `appfolio.db` and `documents/`.
   Move them back to the data directory, replacing any partial ones.
3. Otherwise, restore the recovery backup from `backups/` via the dashboard (into an empty data directory: start with `--data-dir <new folder>`).
4. `tmp/` can always be deleted while Appfolio is stopped.

## Tested

`apps/api/test/backup.test.ts` covers:

- A full round trip into a fresh workspace: JD text, snapshot hashes, file bytes, links, routes, resume associations, assessments, activity, and capture IDs. It also restarts the server afterwards.
- No pairing secrets in the archive.
- Refusal to restore over data without the replace flow; replace creates a working recovery backup.
- Rejection of path traversal, absolute paths, unexpected files, missing manifest, missing hashes, newer schema, non-zip input, tampered bytes, and broken references. Each case leaves active data and `tmp/` untouched.
