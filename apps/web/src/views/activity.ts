import { CAPTURE_METHOD_LABELS, LINK_RELATIONSHIP_LABELS, PLATFORM_LABELS, STATUS_LABELS, type ActivityEvent, type CaptureMethod, type LinkRelationship, type Platform, type Status } from '@appfolio/shared';
import { formatDateTime } from '../lib/format';

const FIELD_LABELS: Record<string, string> = {
  company: 'company',
  title: 'title',
  location: 'location',
  jobType: 'job type',
  program: 'program',
  season: 'season',
  jobId: 'job ID',
  foundOn: 'found-on platform',
  appliedThrough: 'applied-through platform',
  tags: 'tags',
};

export function describeActivity(e: ActivityEvent, docs: Record<string, string>, tz: string): string {
  const d = e.data as Record<string, unknown>;
  const doc = (id: unknown) => (typeof id === 'string' ? (docs[id] ? `“${docs[id]}”` : 'a deleted file') : 'none');
  const status = (s: unknown) => STATUS_LABELS[s as Status] ?? String(s);
  const platform = (p: unknown) => (p ? (PLATFORM_LABELS[p as Platform] ?? String(p)) : 'none');
  switch (e.type) {
    case 'created':
      return `Record created (found on ${platform(d.foundOn)})`;
    case 'status_changed':
      return `Status changed from ${status(d.from)} to ${status(d.to)}${d.note ? ` — ${String(d.note)}` : ''}`;
    case 'marked_applied':
      return `Marked applied (submitted ${formatDateTime(String(d.submittedAt), tz)})${d.resumeDocumentId ? ` with resume ${doc(d.resumeDocumentId)}` : ' without a resume recorded'}${d.note ? ` — ${String(d.note)}` : ''}`;
    case 'submitted_at_corrected':
      return `Submission date corrected from ${d.from ? formatDateTime(String(d.from), tz) : 'none'} to ${d.to ? formatDateTime(String(d.to), tz) : 'none'}`;
    case 'resume_assigned':
      return `Submitted resume recorded: ${doc(d.to)}`;
    case 'resume_reassigned':
      return `Submitted resume corrected from ${doc(d.from)} to ${doc(d.to)}${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'resume_unlinked':
      return `Submitted resume ${doc(d.from)} unlinked${d.reason ? ` — ${String(d.reason)}` : ''}`;
    case 'cover_letter_assigned':
      return `Cover letter recorded: ${doc(d.to)}`;
    case 'cover_letter_reassigned':
      return `Cover letter changed from ${doc(d.from)} to ${doc(d.to)}`;
    case 'cover_letter_unlinked':
      return `Cover letter ${doc(d.from)} unlinked`;
    case 'snapshot_added':
      return `Job description saved (${CAPTURE_METHOD_LABELS[d.method as CaptureMethod] ?? String(d.method)}, ${Number(d.chars).toLocaleString()} characters${d.edited ? ', edited during review' : ''})`;
    case 'primary_snapshot_changed':
      return 'Primary job description snapshot changed';
    case 'link_added':
      return `Linked ${LINK_RELATIONSHIP_LABELS[d.relationship as LinkRelationship]?.split(' (')[0] ?? 'URL'}: ${platform(d.platform)}`;
    case 'link_removed':
      return `Removed link (${platform(d.platform)})`;
    case 'details_edited': {
      const fields = (d.fields as string[] | undefined) ?? [];
      return `Edited ${fields.map((f) => FIELD_LABELS[f] ?? f).join(', ') || 'details'}`;
    }
    case 'notes_edited':
      return 'Notes edited';
    case 'archived':
      return 'Archived';
    case 'unarchived':
      return 'Restored from archive';
    case 'assessment_added':
      return `Assessment added: ${String(d.title)}${d.dueAt ? `, due ${formatDateTime(String(d.dueAt), tz)}` : ''}`;
    case 'assessment_completed':
      return `Assessment completed: ${String(d.title)}`;
    case 'assessment_reopened':
      return `Assessment marked not done: ${String(d.title)}`;
    case 'assessment_rescheduled':
      return `Assessment rescheduled: ${String(d.title)}${d.to ? ` → ${formatDateTime(String(d.to), tz)}` : ''}`;
    case 'assessment_removed':
      return `Assessment removed: ${String(d.title)}`;
    case 'interview_added':
      return `Interview added${d.startsAt ? ` for ${formatDateTime(String(d.startsAt), tz)}` : ''}`;
    case 'interview_updated':
      return 'Interview updated';
    case 'interview_removed':
      return 'Interview removed';
    default:
      return e.type.replace(/_/g, ' ');
  }
}
