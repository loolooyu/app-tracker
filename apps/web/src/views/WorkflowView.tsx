import { useState } from 'react';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';
import { href, navigate } from '../lib/route';
import { SaveJobDialog } from './dialogs/SaveJobDialog';

const STEPS = [
  {
    title: 'Capture the posting',
    body: 'On the full job description, click the Appfolio toolbar icon (or press Alt+Shift+S). Review the text in the side panel and save it as Saved.',
  },
  {
    title: 'Link where you apply',
    body: 'If the JD sends you to an external site (say NUworks → Workday), click Appfolio again there and choose “Link to existing application”.',
  },
  {
    title: 'Submit with the exact resume',
    body: 'After submitting on the company’s site, click Mark applied and pick (or upload) the exact resume version you sent.',
  },
  {
    title: 'Prepare from the packet',
    body: 'When an OA, HireVue or interview arrives, the packet has the saved JD, your resume, deadlines and notes — even if the posting is gone.',
  },
];

export function WorkflowView() {
  const { connection, status, tz } = useApp();
  const [saving, setSaving] = useState(false);
  const pairings = status?.pairings ?? [];
  const lastSync = pairings.map((p) => p.lastReminderSyncAt).filter(Boolean).sort().pop() ?? null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Your Workflow</h1>
          <p className="subtitle">Four steps, from finding a job to walking into the interview prepared.</p>
        </div>
      </header>

      <ol className="steps" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {STEPS.map((s, i) => (
          <li key={s.title} className="card step">
            <span className="step-num" aria-hidden="true">{i + 1}</span>
            <h2 style={{ fontSize: 17 }}><span className="sr-only">Step {i + 1}: </span>{s.title}</h2>
            <p className="small muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="walk">
        <section className="card card-pad stack" aria-labelledby="walk-h">
          <h2 id="walk-h" style={{ fontSize: 20 }}>Browser capture walkthrough</h2>
          <div className="mock-browser" aria-hidden="true">
            <div className="mock-bar">
              <span>● ● ●</span>
              <span className="mock-url">jobs.example.edu/postings/88213</span>
              <span className="mock-ext">A</span>
            </div>
            <div className="mock-body">
              <div className="mock-page">
                <div className="mock-line" style={{ width: '60%', height: 12, background: '#c9d7ea' }} />
                <div className="mock-line" style={{ width: '40%' }} />
                <div className="mock-line" style={{ width: '90%' }} />
                <div className="mock-line" style={{ width: '85%' }} />
                <div className="mock-line" style={{ width: '70%' }} />
                <div className="mock-line" style={{ width: '88%' }} />
              </div>
              <div className="mock-panel">
                <strong style={{ color: 'var(--navy)' }}>Appfolio · Review capture</strong>
                <span>Company · Title · Location</span>
                <div className="mock-line" style={{ width: '100%' }} />
                <div className="mock-line" style={{ width: '92%' }} />
                <span style={{ color: 'var(--warn-fg)' }}>⚠ Check: “See more” may hide text</span>
                <span style={{ background: 'var(--primary)', color: '#fff', borderRadius: 6, padding: '4px 8px', justifySelf: 'start' }}>Save as Saved</span>
              </div>
            </div>
          </div>
          <ol className="stack-sm small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Open the <strong>full</strong> job description while signed in normally. If there’s a “See more” control, expand it first.</li>
            <li>Click the Appfolio icon in Chrome’s toolbar, or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> (<kbd>⌥</kbd><kbd>⇧</kbd><kbd>S</kbd> on Mac). The side panel opens with what was read from this page only.</li>
            <li>Check the company, title, and text. Warnings flag short or incomplete captures; edit anything, or use your selected text or a paste instead.</li>
            <li>Confirm you reviewed it and save. You’ll see “Saved to dashboard” only after the local server confirms it — if it’s offline, the capture is queued in the extension and retried.</li>
          </ol>
          <p className="small muted">
            The extension reads the page only when you click it. It doesn’t read passwords, cookies or form answers, and it never clicks Apply for you.
          </p>
        </section>

        <aside className="stack">
          <section className="card card-pad stack-sm" aria-labelledby="conn-h">
            <h2 id="conn-h" style={{ fontSize: 18 }}>Setup status</h2>
            <ul className="checklist small">
              <li>
                <span className={`dot ${connection === 'online' ? 'ok' : 'bad'}`} style={{ marginTop: 6 }} aria-hidden="true" />
                <span>
                  <strong>Local server:</strong> {connection === 'online' ? 'connected' : connection === 'offline' ? 'not reachable — run npm start' : 'checking…'}
                </span>
              </li>
              <li>
                <span className={`dot ${pairings.length ? 'ok' : ''}`} style={{ marginTop: 6 }} aria-hidden="true" />
                <span>
                  <strong>Browser extension:</strong>{' '}
                  {pairings.length ? (
                    <>paired{pairings[0].lastSeenAt ? `, last seen ${formatDateTime(pairings[0].lastSeenAt, tz)}` : ''}</>
                  ) : (
                    <>not paired yet. <a href={href({ view: 'settings' })}>Pair it in Settings</a>.</>
                  )}
                </span>
              </li>
              <li>
                <span className={`dot ${lastSync ? 'ok' : ''}`} style={{ marginTop: 6 }} aria-hidden="true" />
                <span>
                  <strong>Reminder sync:</strong> {lastSync ? `extension last fetched deadlines ${formatDateTime(lastSync, tz)}` : 'the extension hasn’t fetched deadlines yet'}
                </span>
              </li>
            </ul>
            <p className="small muted">Install steps are in the project README (“Install the extension”): load <span className="code">apps/extension/dist</span> as an unpacked extension in <span className="code">chrome://extensions</span>.</p>
          </section>
          <section className="card card-pad stack-sm" aria-labelledby="man-h">
            <h2 id="man-h" style={{ fontSize: 18 }}>No extension? Use manual entry</h2>
            <p className="small muted">Paste the company, title, URL and description. Works for any site, including ones the extension can’t read.</p>
            <button type="button" className="btn btn-primary" style={{ justifySelf: 'start' }} onClick={() => setSaving(true)} disabled={connection === 'offline'}>Save a job manually</button>
          </section>
        </aside>
      </div>

      {saving && <SaveJobDialog onClose={() => setSaving(false)} onSaved={(id) => { setSaving(false); navigate({ view: 'applications', id }); }} />}
    </>
  );
}
