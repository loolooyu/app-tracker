import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CAPTURE_METHOD_LABELS,
  JD_LIMITS,
  PLATFORMS,
  PLATFORM_LABELS,
  STATUS_LABELS,
  detectPlatform,
  jobIdFromUrl,
  type ApplicationSummary,
  type MatchCandidate,
  type Platform,
} from '@appfolio/shared';
import { SUPPORT_LEVEL_LABELS, computeCaptureWarnings, detectSections } from '@appfolio/shared/extract';
import { apiFetch } from '../lib/api.js';
import { store } from '../lib/storage.js';
import type { Draft, DraftForm, SubmitOutcome } from '../lib/types.js';
import { send } from './state.js';

interface Props {
  draft: Draft;
  conn: 'checking' | 'online' | 'offline';
  nuworksHosts: string[];
  onSubmitted: (o: SubmitOutcome) => void;
}

/** Warnings that depend on the page, not the text, survive edits. */
const CONTEXT_WARNING = /See more|loading|lists \d+ job postings|selectors did not match|structured data has a longer/i;

export function ReviewForm({ draft, conn, nuworksHosts, onSubmitted }: Props) {
  const [f, setF] = useState<DraftForm>(draft.form);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<MatchCandidate[] | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ApplicationSummary[] | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const x = draft.extracted;

  // Persist edits so the draft survives closing the panel or a browser restart.
  const update = (patch: Partial<DraftForm>) => {
    setF((prev) => {
      const next = { ...prev, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void store.putDraft({ ...draft, form: next }), 250);
      return next;
    });
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // Look for existing records: exact URL / job ID first, similar ones only as suggestions.
  useEffect(() => {
    if (conn !== 'online') return;
    const t = setTimeout(() => {
      apiFetch<MatchCandidate[]>('/api/match', {
        method: 'POST',
        body: { url: /^https?:/.test(f.url) ? f.url : null, platform: f.platform, jobId: f.jobId || null, company: f.company || null, title: f.title || null, location: f.location || null },
      })
        .then((m) => { setMatches(m); setMatchError(null); })
        .catch((e) => setMatchError(String((e as Error).message)));
    }, 350);
    return () => clearTimeout(t);
  }, [conn, f.url, f.platform, f.jobId, f.company, f.title, f.location]);

  useEffect(() => {
    if (f.mode !== 'link' || conn !== 'online' || !search.trim()) return setSearchResults(null);
    const t = setTimeout(() => {
      apiFetch<ApplicationSummary[]>(`/api/applications?q=${encodeURIComponent(search.trim())}&archived=all`).then(setSearchResults).catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [search, f.mode, conn]);

  const warnings = useMemo(() => {
    if (!f.text.trim() && f.mode === 'link') return [];
    const live = computeCaptureWarnings(f.text, { method: f.method });
    const context = (x?.warnings ?? []).filter((w) => CONTEXT_WARNING.test(w));
    return [...live, ...context.filter((c) => !live.includes(c))];
  }, [f.text, f.method, f.mode, x]);

  const host = (() => { try { return new URL(f.url).hostname.toLowerCase(); } catch { return null; } })();
  const exact = (matches ?? []).filter((m) => m.kind !== 'similar');
  const tooLong = f.text.length > JD_LIMITS.maxChars;
  const looksLikeForm = f.text.trim().length < 300 || detectSections(f.text).size === 0;
  const urlOk = !f.url || /^https?:\/\/\S+$/i.test(f.url);
  const willSaveSnapshot = f.saveSnapshot && !!f.text.trim();

  const problems: string[] = [];
  if (f.mode === 'new' && !f.company.trim()) problems.push('Add the company.');
  if (f.mode === 'new' && !f.title.trim()) problems.push('Add the job title.');
  if (f.mode === 'link' && !f.linkApplicationId) problems.push('Choose the application to link this page to.');
  if (f.mode === 'link' && !f.url) problems.push('A URL is needed to link this page.');
  if (!urlOk) problems.push('The URL must start with http:// or https://.');
  if (willSaveSnapshot && !f.reviewed) problems.push('Confirm you reviewed the job description.');
  if (tooLong) problems.push(`The text is over ${JD_LIMITS.maxChars.toLocaleString()} characters; remove unrelated content first.`);

  const switchToLink = (app: ApplicationSummary) =>
    update({
      mode: 'link',
      linkApplicationId: app.id,
      linkApplicationLabel: `${app.title} · ${app.company}`,
      // The usual reason to link a page is "this is where I apply"; the user can switch to
      // "another posting of the same job" below.
      relationship: 'application',
      setAppliedThrough: true,
      saveSnapshot: !looksLikeForm,
      reviewed: false,
    });

  const submit = async () => {
    setSaving(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await store.putDraft({ ...draft, form: f });
      const outcome = await send<SubmitOutcome>({ type: 'submit-draft', id: draft.id });
      onSubmitted(outcome);
    } catch (e) {
      onSubmitted({ state: 'rejected', reason: String((e as Error).message) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-labelledby="rev-h">
      <div className="row between">
        <h2 id="rev-h">Review capture</h2>
        <button type="button" className="btn sm ghost" onClick={() => { if (confirm('Discard this draft?')) void send({ type: 'discard-draft', id: draft.id }); }}>Discard</button>
      </div>
      {draft.source.url && <p className="small muted break" title={draft.source.url}>From {draft.source.url}</p>}
      {draft.captureError && <div className="banner warn" role="alert">{draft.captureError}</div>}
      {x && (
        <p className="small muted">
          {CAPTURE_METHOD_LABELS[f.method]} · {x.adapter.label}: {SUPPORT_LEVEL_LABELS[x.adapter.supportLevel]}
        </p>
      )}

      <div className="seg" role="radiogroup" aria-label="What to do with this page">
        <button type="button" role="radio" aria-checked={f.mode === 'new'} className={f.mode === 'new' ? 'on' : ''} onClick={() => update({ mode: 'new', relationship: 'discovery' })}>New application</button>
        <button type="button" role="radio" aria-checked={f.mode === 'link'} className={f.mode === 'link' ? 'on' : ''} onClick={() => update({ mode: 'link', relationship: f.relationship === 'discovery' ? 'application' : f.relationship, saveSnapshot: f.saveSnapshot && !looksLikeForm })}>Link to existing application</button>
      </div>

      {f.mode === 'new' && exact.length > 0 && (
        <div className="banner warn" role="status">
          <strong>Already saved?</strong>
          {exact.map((m) => (
            <div key={m.application.id} className="match">
              <span>{m.application.title} · {m.application.company} <span className="muted">({m.reasons.join(', ')})</span></span>
              <button type="button" className="btn sm" onClick={() => switchToLink(m.application)}>Link to this</button>
            </div>
          ))}
          <span className="small">Or keep “New application” to save a separate record.</span>
        </div>
      )}
      {f.mode === 'new' && exact.length === 0 && matches && matches.length > 0 && (
        <details className="small">
          <summary>{matches.length} similar record{matches.length === 1 ? '' : 's'} — never merged automatically</summary>
          {matches.map((m) => (
            <div key={m.application.id} className="match">
              <span>{m.application.title} · {m.application.company}{m.application.location ? ` · ${m.application.location}` : ''} <span className="muted">({m.reasons.join(', ')})</span></span>
              <button type="button" className="btn sm" onClick={() => switchToLink(m.application)}>Link instead</button>
            </div>
          ))}
        </details>
      )}

      {f.mode === 'link' && (
        <fieldset className="field">
          <legend>Link this page to</legend>
          {conn !== 'online' && !f.linkApplicationId && <p className="small warn-text">Connect to the server to choose an application.</p>}
          {f.linkApplicationId && (
            <div className="chosen">
              <strong>{f.linkApplicationLabel}</strong>
              <button type="button" className="btn sm ghost" onClick={() => update({ linkApplicationId: null, linkApplicationLabel: null })}>Change</button>
            </div>
          )}
          {!f.linkApplicationId && (
            <>
              {(matches ?? []).length > 0 && <span className="small muted">Suggestions</span>}
              <ul className="list">
                {(searchResults ?? (matches ?? []).map((m) => m.application)).slice(0, 8).map((a) => {
                  const m = matches?.find((c) => c.application.id === a.id);
                  return (
                    <li key={a.id}>
                      <button type="button" className="pick" onClick={() => switchToLink(a)}>
                        <strong>{a.title}</strong> · {a.company}
                        <span className="small muted">
                          {' '}{STATUS_LABELS[a.status]} · found on {PLATFORM_LABELS[a.foundOn]}{a.location ? ` · ${a.location}` : ''}
                          {m ? ` · ${m.reasons.join(', ')}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <input className="input" type="search" aria-label="Search your applications" placeholder="Search your applications…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {searchResults && searchResults.length === 0 && <span className="small muted">No matches.</span>}
            </>
          )}
          {matchError && <span className="small muted">{matchError}</span>}
          <label className="field">
            <span>This page is</span>
            <select className="input" value={f.relationship} onChange={(e) => update({ relationship: e.target.value as DraftForm['relationship'], setAppliedThrough: e.target.value === 'application' })}>
              <option value="application">Where I apply (application destination)</option>
              <option value="additional">Another posting of the same job</option>
            </select>
          </label>
          {f.relationship === 'application' && (
            <label className="check"><input type="checkbox" checked={f.setAppliedThrough} onChange={(e) => update({ setAppliedThrough: e.target.checked })} /> Record “Applied through: {PLATFORM_LABELS[f.platform]}” (the original “Found on” stays)</label>
          )}
          <p className="small muted">Linking records the route only. It doesn’t mark anything as applied.</p>
        </fieldset>
      )}

      {f.mode === 'new' && (
        <>
          <label className="field"><span>Company *</span><input className="input" value={f.company} onChange={(e) => update({ company: e.target.value })} /></label>
          <label className="field"><span>Job title *</span><input className="input" value={f.title} onChange={(e) => update({ title: e.target.value })} /></label>
          <div className="two">
            <label className="field"><span>Location</span><input className="input" value={f.location} onChange={(e) => update({ location: e.target.value })} /></label>
            <label className="field"><span>Job ID</span><input className="input" value={f.jobId} onChange={(e) => update({ jobId: e.target.value })} /></label>
          </div>
        </>
      )}
      <div className="two">
        <label className="field">
          <span>{f.mode === 'new' ? 'Found on' : 'Platform of this page'}</span>
          <select className="input" value={f.platform} onChange={(e) => update({ platform: e.target.value as Platform })}>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Page URL</span>
          <input
            className="input"
            value={f.url}
            onChange={(e) => {
              const url = e.target.value;
              const ok = /^https?:\/\//i.test(url);
              update({ url, ...(ok && !draft.extracted ? { platform: detectPlatform(url, { nuworksHosts }), jobId: f.jobId || (jobIdFromUrl(url, detectPlatform(url, { nuworksHosts })) ?? '') } : {}) });
            }}
            spellCheck={false}
          />
        </label>
      </div>
      {f.platform === 'nuworks' && host && !nuworksHosts.includes(host) && (
        <label className="check"><input type="checkbox" checked={f.rememberNuworksHost} onChange={(e) => update({ rememberNuworksHost: e.target.checked })} /> Always treat {host} as NUworks</label>
      )}

      <fieldset className="field">
        <legend>Job description</legend>
        {f.mode === 'link' && (
          <label className="check">
            <input type="checkbox" checked={f.saveSnapshot} onChange={(e) => update({ saveSnapshot: e.target.checked, reviewed: false })} />
            Save this page’s description as a new dated snapshot (earlier snapshots stay unchanged)
          </label>
        )}
        {f.mode === 'link' && !f.saveSnapshot && <p className="small muted">Only the URL will be linked — use this when the page is just an application form.</p>}
        {(f.mode === 'new' || f.saveSnapshot) && (
          <>
            {x && x.alternatives.length > 0 && (
              <div className="row wrap small">
                <span className="muted">Use instead:</span>
                {x.alternatives.map((a, i) => (
                  <button
                    key={`${a.method}-${i}`}
                    type="button"
                    className="btn sm"
                    onClick={() =>
                      update({
                        text: a.text,
                        rawText: a.text,
                        method: a.method,
                        reviewed: false,
                        ...(a.meta ? { title: a.meta.title ?? f.title, company: a.meta.company ?? f.company, location: a.meta.location ?? f.location, jobId: a.meta.jobId ?? f.jobId } : {}),
                      })
                    }
                  >
                    {a.label} ({a.text.length.toLocaleString()})
                  </button>
                ))}
              </div>
            )}
            {x && x.postings.length > 1 && <p className="small warn-text">This page lists several jobs. Pick the right one with the “Posting: …” buttons above, or open that job’s own page and recapture.</p>}
            <textarea
              className="input jd"
              aria-label="Job description text"
              value={f.text}
              onChange={(e) => update({ text: e.target.value, reviewed: false, method: f.method === 'manual_paste' || !draft.extracted ? 'manual_paste' : f.method })}
              placeholder="Paste or select the job description. Keep qualifications, pay and application instructions."
              aria-invalid={tooLong}
            />
            <div className="row between small">
              <span className={tooLong ? 'error-text' : 'muted'}>{f.text.length.toLocaleString()} characters{f.text !== f.rawText && f.rawText ? ' · edited (original capture kept too)' : ''}</span>
              {f.text !== f.rawText && f.rawText && <button type="button" className="link" onClick={() => update({ text: f.rawText, reviewed: false })}>Undo edits</button>}
            </div>
            {warnings.length > 0 && (
              <ul className="warnings" aria-label="Capture warnings">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            {f.mode === 'link' && <label className="check"><input type="checkbox" checked={f.makePrimary} onChange={(e) => update({ makePrimary: e.target.checked })} /> Make this the primary JD for the application</label>}
            {f.text.trim() && (
              <label className="check strong">
                <input type="checkbox" checked={f.reviewed} onChange={(e) => update({ reviewed: e.target.checked })} />
                I reviewed this text and it’s the full job description
              </label>
            )}
          </>
        )}
      </fieldset>

      {problems.length > 0 && <ul className="problems small">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <button type="button" className="btn primary block" disabled={saving || problems.length > 0} onClick={() => void submit()}>
        {saving ? 'Saving…' : f.mode === 'new' ? (conn === 'offline' ? 'Save (will queue offline)' : 'Save as Saved') : conn === 'offline' ? 'Link (will queue offline)' : willSaveSnapshot ? 'Link page and save snapshot' : 'Link URL only'}
      </button>
      <p className="small muted center">Saving never marks a job as applied.</p>
    </section>
  );
}
