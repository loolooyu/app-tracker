import { useEffect, useState } from 'react';
import { apiFetch, dashboardUrl, validApiBase } from '../lib/api.js';
import { store } from '../lib/storage.js';
import type { SubmitOutcome } from '../lib/types.js';
import { ReviewForm } from './ReviewForm.js';
import { send, usePanelState } from './state.js';

type Conn = 'checking' | 'online' | 'offline';

function useServer(apiBase: string | undefined): Conn {
  const [conn, setConn] = useState<Conn>('checking');
  useEffect(() => {
    if (!apiBase) return;
    let alive = true;
    const check = async () => {
      try {
        await apiFetch('/api/health', { auth: false, timeoutMs: 3000 });
        if (alive) setConn('online');
      } catch {
        if (alive) setConn('offline');
      }
    };
    void check();
    const t = setInterval(check, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [apiBase]);
  return conn;
}

export function App() {
  const st = usePanelState();
  const conn = useServer(st.settings?.apiBase);
  const [lastOutcome, setLastOutcome] = useState<SubmitOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Retry queued captures whenever the panel opens or the server comes back.
  useEffect(() => {
    if (conn === 'online' && st.paired) void send({ type: 'flush-queue' }).catch(() => undefined);
  }, [conn, st.paired]);

  if (!st.loaded || !st.settings) return <div className="pad muted">Loading…</div>;
  if (!st.paired) return <PairingScreen apiBase={st.settings.apiBase} conn={conn} />;

  const active = st.drafts.find((d) => d.id === st.activeId) ?? null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <header className="top">
        <span className="brand"><span className="mark" aria-hidden="true">A</span> Appfolio</span>
        <span className={`conn ${conn}`} role="status">
          <span className="dot" aria-hidden="true" />
          {conn === 'online' ? 'Server connected' : conn === 'offline' ? 'Server offline' : 'Checking…'}
        </span>
      </header>

      {conn === 'offline' && (
        <div className="banner warn" role="alert">
          The Appfolio server on this computer isn’t reachable. You can still review and save — captures are <strong>queued here</strong> and sent when it’s back (run <code>npm start</code>).
        </div>
      )}

      {lastOutcome && <OutcomeBanner outcome={lastOutcome} onDismiss={() => setLastOutcome(null)} />}

      {st.queue.length > 0 && (
        <section className="card" aria-labelledby="q-h">
          <h2 id="q-h">Waiting to sync ({st.queue.length})</h2>
          <p className="small muted">Saved in this browser only — not in your dashboard yet.</p>
          <ul className="list">
            {st.queue.map((q) => (
              <li key={q.captureId} className={`qitem ${q.state}`}>
                <div>
                  <strong>{q.summary.title || 'Untitled'}</strong>
                  {q.summary.company && <span className="muted"> · {q.summary.company}</span>}
                  <div className="small muted">
                    {q.state === 'attention' ? 'Needs attention: ' : 'Queued. '}
                    {q.lastError ?? 'Not sent yet.'} {q.attempts > 0 && `(${q.attempts} attempt${q.attempts === 1 ? '' : 's'})`}
                  </div>
                </div>
                <div className="row">
                  {q.state === 'attention' && <button type="button" className="btn sm" onClick={() => void run(async () => void (await send({ type: 'queued-to-draft', captureId: q.captureId })))}>Edit</button>}
                  <button type="button" className="btn sm ghost" onClick={() => { if (confirm('Delete this queued capture? It has not reached your dashboard.')) void send({ type: 'delete-queued', captureId: q.captureId }); }}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void run(async () => void (await send({ type: 'flush-queue' })))}>Retry now</button>
        </section>
      )}

      {st.drafts.length > 1 && (
        <nav className="drafts" aria-label="Drafts">
          <span className="small muted">Drafts:</span>
          {st.drafts.map((d) => (
            <button key={d.id} type="button" className={`chip${d.id === active?.id ? ' on' : ''}`} aria-pressed={d.id === active?.id} onClick={() => void store.setActiveDraft(d.id)}>
              {(d.form.title || d.source.title || 'Untitled').slice(0, 28)}
            </button>
          ))}
        </nav>
      )}

      {active ? (
        <ReviewForm
          key={active.id}
          draft={active}
          conn={conn}
          nuworksHosts={st.settings.nuworksHosts}
          onSubmitted={(o) => setLastOutcome(o)}
        />
      ) : (
        <section className="card empty">
          <h2>Capture a job</h2>
          <p className="small">Open the full job description, then click the <strong>Appfolio</strong> toolbar icon or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>. The page is read only when you do this.</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => void (await send({ type: 'capture-active-tab' })))}>Capture current tab</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => void (await send({ type: 'new-manual-draft' })))}>Paste manually</button>
          </div>
          <p className="small muted">“Capture current tab” works right after you click the toolbar icon on that page. If Chrome says access was lost, click the icon again.</p>
        </section>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}

      <footer className="foot">
        <button type="button" className="link" onClick={async () => chrome.tabs.create({ url: await dashboardUrl() })}>Open dashboard</button>
        <button type="button" className="link" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}>Extension settings</button>
      </footer>
      {showSettings && <SettingsPanel lastSync={st.lastSync} />}
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = {
  created: 'New application created (status: Saved).',
  linked: 'This page was linked to the existing application.',
  link_exists: 'This page was already linked — nothing duplicated.',
  snapshot_added: 'Job description saved as a new dated snapshot.',
  snapshot_reused: 'Identical job description was already saved — reused, not duplicated.',
};

function OutcomeBanner({ outcome, onDismiss }: { outcome: SubmitOutcome; onDismiss: () => void }) {
  if (outcome.state === 'saved') {
    const r = outcome.record.result;
    return (
      <div className="banner ok" role="status">
        <strong>Saved to dashboard.</strong>
        <ul className="small">
          {r.replayed && <li>Already saved on an earlier try — nothing duplicated.</li>}
          {r.outcomes.map((o) => <li key={o}>{OUTCOME_TEXT[o]}</li>)}
        </ul>
        <div className="row">
          <button type="button" className="btn sm" onClick={async () => chrome.tabs.create({ url: await dashboardUrl(r.applicationId) })}>Open in dashboard</button>
          <button type="button" className="btn sm ghost" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    );
  }
  if (outcome.state === 'queued') {
    return (
      <div className="banner warn" role="status">
        <strong>Queued — not in your dashboard yet.</strong> {outcome.reason} It’s stored in this browser and will be sent automatically when the server is reachable.
        <div className="row"><button type="button" className="btn sm ghost" onClick={onDismiss}>Dismiss</button></div>
      </div>
    );
  }
  return (
    <div className="banner error" role="alert">
      <strong>Not saved.</strong> {outcome.reason} Use “Edit” in the queue to fix it.
      <div className="row"><button type="button" className="btn sm ghost" onClick={onDismiss}>Dismiss</button></div>
    </div>
  );
}

function PairingScreen({ apiBase, conn }: { apiBase: string; conn: Conn }) {
  const [base, setBase] = useState(apiBase);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pair = async () => {
    setBusy(true);
    setError(null);
    try {
      const valid = validApiBase(base);
      if (!valid) throw new Error('Use http://127.0.0.1:<port> or http://localhost:<port>.');
      await store.saveSettings({ apiBase: valid });
      const r = await apiFetch<{ token: string }>('/api/pair', { method: 'POST', auth: false, body: { code, extensionName: 'Chrome' } });
      await store.setToken(r.token);
      await send({ type: 'flush-queue' }).catch(() => undefined);
      await send({ type: 'sync-reminders' }).catch(() => undefined);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <header className="top"><span className="brand"><span className="mark" aria-hidden="true">A</span> Appfolio</span></header>
      <section className="card">
        <h2>Pair with your dashboard</h2>
        <ol className="small steps">
          <li>Start Appfolio on this computer (<code>npm start</code>) and open the dashboard.</li>
          <li>Go to <strong>Settings &amp; Backup → Browser extension pairing</strong> and click <strong>Generate pairing code</strong>.</li>
          <li>Enter the code here.</li>
        </ol>
        <label className="field">
          <span>Server address</span>
          <input className="input" value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} />
          <span className={`small ${conn === 'online' ? 'ok-text' : 'muted'}`}>{conn === 'online' ? 'Server reachable' : conn === 'offline' ? 'Server not reachable at this address' : 'Checking…'}</span>
        </label>
        <label className="field">
          <span>Pairing code</span>
          <input className="input code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" autoComplete="off" spellCheck={false} />
        </label>
        <button type="button" className="btn primary" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length < 8} onClick={() => void pair()}>
          {busy ? 'Pairing…' : 'Pair extension'}
        </button>
        {error && <div className="banner error" role="alert">{error}</div>}
        <p className="small muted">The extension stores its key only in this browser’s extension storage. You can unpair or reset from either side.</p>
      </section>
    </div>
  );
}

function SettingsPanel({ lastSync }: { lastSync: string | null }) {
  const st = usePanelState();
  const [hosts, setHosts] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (st.settings) setHosts(st.settings.nuworksHosts.join('\n'));
  }, [st.settings]);
  if (!st.settings) return null;
  const s = st.settings;
  return (
    <section className="card" aria-labelledby="set-h">
      <h2 id="set-h">Extension settings</h2>
      <label className="field">
        <span>NUworks hostnames</span>
        <textarea className="input" rows={2} value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="One per line, copied from the address bar on a NUworks posting" spellCheck={false} />
        <span className="small muted">Appfolio doesn’t guess NUworks’ address. Pages on these hosts are labelled NUworks.</span>
      </label>
      <button type="button" className="btn sm" onClick={async () => {
        const list = hosts.split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
        await store.saveSettings({ nuworksHosts: [...new Set(list)] });
        setMsg('Saved.');
      }}>Save hostnames</button>

      <label className="check">
        <input
          type="checkbox"
          checked={s.notifications}
          onChange={async (e) => {
            if (e.target.checked) {
              const granted = await chrome.permissions.request({ permissions: ['notifications'] });
              if (!granted) return setMsg('Notifications permission was not granted.');
            }
            await store.saveSettings({ notifications: e.target.checked });
            const r = await send<{ stale: boolean; scheduled: number }>({ type: 'sync-reminders' });
            setMsg(e.target.checked ? `Reminders on. ${r.scheduled} scheduled${r.stale ? ' (using the last saved schedule — server unreachable)' : ''}.` : 'Reminders off.');
          }}
        />
        <span>OA/HireVue browser reminders</span>
      </label>
      <p className="small muted">
        Notifications need Chrome running and OS permission. If Chrome is closed or the computer sleeps, a reminder can’t arrive on time; you get one catch-up notice later if the deadline hasn’t passed. The dashboard’s due list is the source of truth.
        {lastSync ? ` Deadlines last synced ${new Date(lastSync).toLocaleString()}.` : ' Deadlines not synced yet.'}
      </p>
      <button type="button" className="btn sm" onClick={async () => { const r = await send<{ stale: boolean; scheduled: number }>({ type: 'sync-reminders' }); setMsg(r.stale ? 'Server unreachable — kept the last saved schedule.' : `Synced. ${r.scheduled} reminder(s) scheduled.`); }}>Sync deadlines now</button>
      <hr />
      <button type="button" className="btn sm danger" onClick={async () => { if (confirm('Unpair this browser? Queued captures stay and send after you pair again.')) await store.setToken(null); }}>Unpair this browser</button>
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
