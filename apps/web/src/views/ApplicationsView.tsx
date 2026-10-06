import { useCallback, useEffect, useMemo, useState } from 'react';
import { PLATFORMS, PLATFORM_LABELS, STATUSES, STATUS_LABELS, relativeDue, type ApplicationSummary, type UpcomingAssessment } from '@appfolio/shared';
import { api, type ListParams } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDate, formatDateTime, platformLabel } from '../lib/format';
import { href, navigate } from '../lib/route';
import { IconInfo, IconPlus, IconSearch } from '../components/Icons';
import { StatusBadge } from '../components/StatusBadge';
import { Packet } from './Packet';
import { SaveJobDialog } from './dialogs/SaveJobDialog';

const SUMMARY_HELP = {
  applications: 'Active (not archived) records that have a submission date. Saved jobs you haven’t applied to are not counted.',
  interviews: 'Active records whose status is currently Interview.',
  assessments: 'Incomplete OA/HireVue tasks with a due time on active records. Overdue ones are counted separately.',
  jds: 'Active applications with at least one saved job description, regardless of how many snapshots each has.',
};

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ApplicationsView({ selectedId }: { selectedId: string | null }) {
  const { summary, tz, version, refresh, connection, reportError } = useApp();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Omit<ListParams, 'q'>>({ sort: 'updated', archived: 'active' });
  const q = useDebounced(query, 200);
  const [items, setItems] = useState<ApplicationSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingAssessment[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, up] = await Promise.all([api.list({ ...filters, q }), api.upcoming()]);
      setItems(list);
      setUpcoming(up);
      setLoadError(null);
    } catch (e) {
      setLoadError(reportError(e));
    }
  }, [filters, q, reportError]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const changed = useCallback(() => refresh(), [refresh]);
  const filtering = !!q || filters.platform || filters.status || filters.missingResume || filters.assessmentDue || filters.archived !== 'active';
  const selectedInList = useMemo(() => !selectedId || !items || items.some((i) => i.id === selectedId), [items, selectedId]);
  const empty = summary && summary.totalRecords === 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Every application, remembered.</h1>
          <p className="subtitle">The role. The description. The resume you actually sent.</p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => setSaving(true)} disabled={connection === 'offline'}>
          <IconPlus /> Save a job
        </button>
      </header>

      <section className="summary" aria-label="Summary">
        <Stat label="Applications" value={summary?.applications} help={SUMMARY_HELP.applications} />
        <Stat label="Interviews" value={summary?.interviews} help={SUMMARY_HELP.interviews} />
        <Stat
          label="Assessments due"
          value={summary?.assessmentsDue}
          help={SUMMARY_HELP.assessments}
          note={summary && summary.assessmentsOverdue > 0 ? `${summary.assessmentsOverdue} overdue` : undefined}
          warn={!!summary && summary.assessmentsOverdue > 0}
        />
        <Stat label="JDs preserved" value={summary?.jdsPreserved} help={SUMMARY_HELP.jds} />
      </section>

      {summary?.hasDemoData && (
        <div className="banner demo" role="note">
          <span>
            <strong>Demo workspace.</strong> These records and resumes are fictional sample data. Remove them in{' '}
            <a href={href({ view: 'settings' })}>Settings &amp; Backup</a> before tracking real applications.
          </span>
        </div>
      )}

      {upcoming.length > 0 && <UpNext items={upcoming} tz={tz} />}

      {empty ? (
        <Onboarding onSave={() => setSaving(true)} />
      ) : (
        <div className={`workspace${selectedId ? ' has-selection' : ''}`}>
          <section className="card list-panel" aria-label="Applications list">
            <div className="list-tools">
              <div className="search">
                <IconSearch />
                <label htmlFor="search" className="sr-only">Search applications and saved job descriptions</label>
                <input
                  id="search"
                  className="input"
                  type="search"
                  placeholder="Search company, title, notes, saved JDs…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="filters">
                <label className="sr-only" htmlFor="f-platform">Source platform</label>
                <select id="f-platform" className="select" value={filters.platform ?? ''} onChange={(e) => setFilters({ ...filters, platform: e.target.value || undefined })}>
                  <option value="">All platforms</option>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="f-status">Status</label>
                <select id="f-status" className="select" value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}>
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="f-sort">Sort by</label>
                <select id="f-sort" className="select" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as ListParams['sort'] })}>
                  <option value="updated">Recently updated</option>
                  <option value="submitted">Submitted date</option>
                  <option value="next_due">Next assessment due</option>
                  <option value="company">Company A–Z</option>
                </select>
              </div>
              <div className="filters">
                <button type="button" className="chip-toggle" aria-pressed={!!filters.missingResume} onClick={() => setFilters({ ...filters, missingResume: !filters.missingResume })}>
                  Resume needed
                </button>
                <button type="button" className="chip-toggle" aria-pressed={!!filters.assessmentDue} onClick={() => setFilters({ ...filters, assessmentDue: !filters.assessmentDue })}>
                  Assessment due
                </button>
                <button
                  type="button"
                  className="chip-toggle"
                  aria-pressed={filters.archived === 'archived'}
                  onClick={() => setFilters({ ...filters, archived: filters.archived === 'archived' ? 'active' : 'archived' })}
                >
                  Archived
                </button>
                {filtering && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setFilters({ sort: filters.sort, archived: 'active' }); }}>
                    Clear
                  </button>
                )}
              </div>
            </div>
            {loadError && !items ? (
              <div className="empty" role="alert">
                <h3>Couldn’t load applications</h3>
                <p>{loadError}</p>
                <button type="button" className="btn" onClick={() => void load()}>Try again</button>
              </div>
            ) : !items ? (
              <div className="stack" style={{ padding: 16 }} aria-busy="true" aria-label="Loading applications">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="stack-sm"><div className="skeleton" style={{ width: '70%' }} /><div className="skeleton" style={{ width: '45%' }} /></div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="empty">
                <h3>No matching applications</h3>
                <p>{q ? <>Nothing matches “{q}” in titles, companies, notes or saved job descriptions.</> : 'No records match these filters.'}</p>
                <button type="button" className="btn" onClick={() => { setQuery(''); setFilters({ sort: filters.sort, archived: 'active' }); }}>Clear search and filters</button>
              </div>
            ) : (
              <ul className="list" aria-label={`${items.length} applications`}>
                {items.map((a) => (
                  <li key={a.id}>
                    <ListRow a={a} selected={a.id === selectedId} tz={tz} />
                  </li>
                ))}
              </ul>
            )}
            {items && items.length > 0 && (
              <div className="list-count" aria-live="polite">
                {items.length} {items.length === 1 ? 'record' : 'records'}
                {filtering ? ' match' : ''}
              </div>
            )}
          </section>

          <section className="card packet" aria-label="Application packet">
            {selectedId ? (
              <Packet id={selectedId} onChanged={changed} notInList={!selectedInList} />
            ) : (
              <div className="empty" style={{ minHeight: 420, alignContent: 'center' }}>
                <h2 style={{ fontSize: 22 }}>Select an application</h2>
                <p>Its packet shows the saved job description, the exact resume you sent, assessments and notes together.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {saving && (
        <SaveJobDialog
          onClose={() => setSaving(false)}
          onSaved={(id) => {
            setSaving(false);
            refresh();
            navigate({ view: 'applications', id });
          }}
        />
      )}
    </>
  );
}

function Stat({ label, value, help, note, warn }: { label: string; value: number | undefined; help: string; note?: string; warn?: boolean }) {
  return (
    <div className="card stat">
      <span className="stat-label">
        {label}
        <span className="info-tip" title={help} aria-label={`How “${label}” is counted: ${help}`} role="img">
          <IconInfo />
        </span>
      </span>
      <span className="stat-value">{value ?? '–'}</span>
      {note ? <span className={`stat-note${warn ? ' warn' : ''}`}>{note}</span> : <span className="stat-note">&nbsp;</span>}
    </div>
  );
}

function ListRow({ a, selected, tz }: { a: ApplicationSummary; selected: boolean; tz: string }) {
  return (
    <a
      className="list-row"
      href={href({ view: 'applications', id: a.id })}
      aria-current={selected ? 'true' : undefined}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <span className="list-row-top">
        <span className="list-row-title truncate">{a.title}</span>
        <span className="spacer" />
        <StatusBadge status={a.status} />
      </span>
      <span className="list-row-company truncate">
        {a.company}
        {a.location ? ` · ${a.location}` : ''}
      </span>
      <span className="list-row-meta">
        <span>{a.submittedAt ? `Applied ${formatDate(a.submittedAt, tz)}` : 'Not submitted'}</span>
        <span aria-hidden="true">·</span>
        <span>{platformLabel(a.foundOn)}{a.appliedThrough && a.appliedThrough !== a.foundOn ? ` → ${platformLabel(a.appliedThrough)}` : ''}</span>
        {a.resumeNeeded && <span className="badge warn plain">Resume needed</span>}
        {!a.hasSnapshot && <span className="badge outline plain">No saved JD</span>}
        {a.nextAssessment && (
          <span className={`badge plain ${a.nextAssessment.overdue ? 'danger' : 'st-assessment'}`}>
            {a.nextAssessment.overdue ? 'Overdue' : 'Due'} {relativeDue(a.nextAssessment.dueAt).text.replace(' overdue', '')}
          </span>
        )}
        {a.archived && <span className="badge outline plain">Archived</span>}
        {a.isDemo && <span className="badge demo plain">Demo</span>}
      </span>
      {a.matchedIn && a.matchedIn.length > 0 && (
        <span className="list-row-meta">Matched in {a.matchedIn.join(', ')}</span>
      )}
      {a.snippet && <span className="snippet">{a.snippet}</span>}
    </a>
  );
}

function UpNext({ items, tz }: { items: UpcomingAssessment[]; tz: string }) {
  const { status } = useApp();
  const overdue = items.filter((i) => i.overdue).length;
  // Browser reminders come from the extension's cached copy; say so when it may be behind.
  const lastSync = (status?.pairings ?? []).map((p) => p.lastReminderSyncAt).filter(Boolean).sort().pop() ?? null;
  const latestChange = items.map((i) => i.updatedAt).sort().pop() ?? null;
  const paired = (status?.pairings.length ?? 0) > 0;
  const stale = paired && latestChange && (!lastSync || lastSync < latestChange);
  const shown = items.filter((i) => i.dueAt).slice(0, 8);
  if (!shown.length) return null;
  return (
    <section className="card upnext" aria-labelledby="upnext-h">
      <div className="row">
        <h2 id="upnext-h" style={{ fontSize: 18 }}>OA &amp; HireVue up next</h2>
        {overdue > 0 && <span className="badge danger">{overdue} overdue</span>}
        <span className="spacer" />
        <span className="small muted">Times shown in {tz.replace(/_/g, ' ')}</span>
      </div>
      {stale && (
        <p className="small muted" role="note">
          Browser reminders may not include your latest changes yet — the extension last synced deadlines {lastSync ? formatDateTime(lastSync, tz) : 'never'}. It syncs about every 15 minutes while Chrome is running. This list is always current.
        </p>
      )}
      <div className="upnext-list">
        {shown.map((i) => (
          <a key={i.id} className={`upnext-item${i.overdue ? ' overdue' : ''}`} href={href({ view: 'applications', id: i.applicationId })} style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="small" style={{ fontWeight: 700, color: i.overdue ? 'var(--danger)' : 'var(--st-assess-fg)' }}>
              {i.overdue ? 'Overdue · ' : ''}{relativeDue(i.dueAt!).text}
            </span>
            <span style={{ fontWeight: 650 }} className="truncate">{i.title}</span>
            <span className="small muted truncate">{i.company} · {i.applicationTitle}</span>
            <span className="small muted">{formatDateTime(i.dueAt, tz)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Onboarding({ onSave }: { onSave: () => void }) {
  return (
    <section className="card card-pad" aria-labelledby="onb-h">
      <div className="stack" style={{ maxWidth: 720 }}>
        <h2 id="onb-h" style={{ fontSize: 24 }}>Start your first application packet</h2>
        <p className="muted">
          Save the job description while you can still see it, then record the exact resume you submit. Everything stays on this computer.
        </p>
        <ol className="checklist">
          <li><span className="step-num">1</span><span><strong>Install and pair the browser extension</strong> so you can capture the job page you’re viewing. <a href={href({ view: 'workflow' })}>See how</a>.</span></li>
          <li><span className="step-num">2</span><span><strong>Or paste a job manually.</strong> Works for any site, including ones the extension can’t read.</span></li>
          <li><span className="step-num">3</span><span><strong>Add your resume versions</strong> in the <a href={href({ view: 'resumes' })}>Resume Library</a>.</span></li>
        </ol>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={onSave}>
            <IconPlus /> Save a job manually
          </button>
          <a className="btn" href={href({ view: 'settings' })}>Load fictional demo data</a>
        </div>
      </div>
    </section>
  );
}
