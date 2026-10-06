import { ASSESSMENT_TYPE_LABELS, PLATFORM_LABELS, STATUS_LABELS, type Platform, type Status } from '@appfolio/shared';
import type { Ctx } from '../store/core.js';

/** Quote a CSV cell and neutralize spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Spreadsheet-friendly overview. Not a backup: no JD text, no files. */
export function applicationsCsv(ctx: Ctx): string {
  const rows = ctx.db
    .prepare(
      `SELECT a.*, r.label AS resume_label, r.original_filename AS resume_filename,
        (SELECT url FROM source_links l WHERE l.application_id = a.id AND l.relationship = 'discovery' ORDER BY added_at LIMIT 1) AS discovery_url,
        (SELECT url FROM source_links l WHERE l.application_id = a.id AND l.relationship = 'application' ORDER BY added_at LIMIT 1) AS application_url,
        (SELECT COUNT(*) FROM jd_snapshots s WHERE s.application_id = a.id) AS snapshots,
        (SELECT MIN(due_at) FROM assessments x WHERE x.application_id = a.id AND x.completed_at IS NULL AND x.due_at IS NOT NULL) AS next_due
       FROM applications a LEFT JOIN documents r ON r.id = a.submitted_resume_document_id
       ORDER BY a.submitted_at IS NULL, a.submitted_at DESC, a.updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  const header = [
    'Company', 'Title', 'Location', 'Status', 'Found on', 'Applied through', 'Submitted (UTC)', 'Resume label', 'Resume filename',
    'Found-on URL', 'Applied-through URL', 'Saved JD snapshots', 'Next assessment due (UTC)', 'Archived', 'Tags', 'Created (UTC)', 'Updated (UTC)',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.company, r.title, r.location, STATUS_LABELS[r.status as Status], PLATFORM_LABELS[r.found_on as Platform],
        r.applied_through ? PLATFORM_LABELS[r.applied_through as Platform] : '', r.submitted_at, r.resume_label, r.resume_filename,
        r.discovery_url, r.application_url, r.snapshots, r.next_due, r.archived ? 'yes' : 'no',
        (JSON.parse(String(r.tags ?? '[]')) as string[]).join('; '), r.created_at, r.updated_at,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
}
function icsDate(iso: string) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
/** Fold lines longer than 75 octets per RFC 5545. */
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function assessmentIcs(a: {
  id: string;
  title: string;
  type: keyof typeof ASSESSMENT_TYPE_LABELS;
  dueAt: string;
  timezone: string;
  url: string | null;
  company: string;
  applicationTitle: string;
  reminderOffsetsMinutes: number[];
  dashboardUrl: string;
}): string {
  const due = icsDate(new Date(a.dueAt).toISOString());
  const start = icsDate(new Date(new Date(a.dueAt).getTime() - 30 * 60_000).toISOString());
  const desc = [
    `${ASSESSMENT_TYPE_LABELS[a.type]} for ${a.applicationTitle} at ${a.company}.`,
    `Due ${a.dueAt} (entered in ${a.timezone}).`,
    a.url ? `Assessment link: ${a.url}` : '',
    `Application packet: ${a.dashboardUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appfolio//Assessment reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.id}@appfolio.local`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${due}`,
    `SUMMARY:${icsEscape(`Due: ${a.title} — ${a.company}`)}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    ...(a.url ? [`URL:${a.url}`] : []),
    ...a.reminderOffsetsMinutes.flatMap((m) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(a.title)}`, `TRIGGER;RELATED=END:-PT${m}M`, 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
