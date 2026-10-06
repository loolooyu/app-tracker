/**
 * Ordered schema migrations. Never edit a released migration; append a new one.
 * Each migration runs in its own transaction and bumps schema_migrations.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('resume','cover_letter')),
  label TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  content_hash TEXT NOT NULL UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

-- Uploaded bytes and their identity never change. Only the label may be edited.
CREATE TRIGGER documents_immutable
BEFORE UPDATE OF type, original_filename, mime_type, byte_size, content_hash, storage_key, created_at ON documents
BEGIN
  SELECT RAISE(ABORT, 'documents are immutable; upload a new version instead');
END;

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  job_type TEXT,
  program TEXT,
  season TEXT,
  job_id TEXT,
  found_on TEXT NOT NULL,
  applied_through TEXT,
  status TEXT NOT NULL CHECK (status IN ('saved','applied','assessment','interview','offer','rejected','withdrawn')),
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  primary_snapshot_id TEXT REFERENCES jd_snapshots(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  submitted_resume_document_id TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  submitted_cover_letter_document_id TEXT REFERENCES documents(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX applications_updated ON applications(updated_at);
CREATE INDEX applications_resume ON applications(submitted_resume_document_id);
CREATE INDEX applications_cover ON applications(submitted_cover_letter_document_id);

CREATE TABLE source_links (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  platform TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('discovery','application','additional')),
  job_id TEXT,
  added_at TEXT NOT NULL,
  UNIQUE (application_id, normalized_url)
);
CREATE INDEX source_links_normalized ON source_links(normalized_url);
CREATE INDEX source_links_job ON source_links(platform, job_id);

CREATE TABLE jd_snapshots (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source_link_id TEXT REFERENCES source_links(id) ON DELETE SET NULL,
  source_url TEXT,
  captured_at TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  reviewed_text TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('adapter','structured_data','generic_dom','selected_text','manual_paste')),
  warnings TEXT NOT NULL DEFAULT '[]',
  review_confirmed_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  page_title TEXT,
  capture_id TEXT
);
CREATE INDEX jd_snapshots_app ON jd_snapshots(application_id);
CREATE INDEX jd_snapshots_hash ON jd_snapshots(application_id, content_hash);

-- Committed snapshots are immutable. Corrections create a new snapshot.
CREATE TRIGGER jd_snapshots_immutable
BEFORE UPDATE OF application_id, captured_at, raw_text, reviewed_text, method, warnings, review_confirmed_at, content_hash, char_count, source_url ON jd_snapshots
BEGIN
  SELECT RAISE(ABORT, 'job description snapshots are immutable; add a new snapshot instead');
END;

CREATE TABLE assessments (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  due_at TEXT,
  timezone TEXT NOT NULL,
  completed_at TEXT,
  reminder_offsets TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX assessments_app ON assessments(application_id);
CREATE INDEX assessments_due ON assessments(due_at);

CREATE TABLE interviews (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  title TEXT,
  starts_at TEXT,
  timezone TEXT NOT NULL,
  format TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX interviews_app ON interviews(application_id);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX activity_app ON activity(application_id, at);

-- Idempotency for extension captures: a retried capture ID returns the original result.
CREATE TABLE capture_requests (
  capture_id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables included in backups, in an order that satisfies foreign keys on insert. */
export const BACKUP_TABLES = [
  'settings',
  'documents',
  'applications',
  'source_links',
  'jd_snapshots',
  'assessments',
  'interviews',
  'activity',
  'capture_requests',
] as const;
