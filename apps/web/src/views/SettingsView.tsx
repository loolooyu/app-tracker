import { useRef, useState } from 'react';
import { browserTimeZone, describeOffset, type RestoreSummary } from '@appfolio/shared';
import { api, urls } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatBytes, formatDateTime } from '../lib/format';
import { TimezoneSelect } from '../components/DateTimeField';
import { useToast } from '../components/Toasts';
import { ConfirmDialog } from './dialogs/ConfirmDialog';

const OFFSET_CHOICES = [10080, 4320, 1440, 360, 120, 30];
const TABLE_LABELS: Record<string, string> = {
  applications: 'Applications',
  jd_snapshots: 'Saved JDs',
  documents: 'Documents',
  source_links: 'Links',
  assessments: 'Assessments',
  interviews: 'Interviews',
  activity: 'Activity events',
};

export function SettingsView() {
  const { settings, setSettings, status, summary, tz, refresh, reportError, connection } = useApp();
  const { notify } = useToast();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [staged, setStaged] = useState<RestoreSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [replaceText, setReplaceText] = useState('');
  const [removeDemo, setRemoveDemo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const offline = connection === 'offline';

  const saveSettings = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      setSettings(await api.updateSettings(patch));
      notify('Settings saved');
    } catch (e) {
      notify(reportError(e), 'error');
    }
  };

  const offsets = settings?.defaultReminderOffsetsMinutes ?? [1440, 120];
  const pairings = status?.pairings ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings &amp; Backup</h1>
          <p className="subtitle">Your data lives on this computer. Back it up somewhere safe.</p>
        </div>
      </header>

      <section className="card card-pad stack" aria-labelledby="tz-h">
        <h2 id="tz-h" style={{ fontSize: 20 }}>Time &amp; reminders</h2>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="tz">Display time zone</label>
            <div className="row">
              <div style={{ flex: 1 }}>
                <TimezoneSelect id="tz" value={settings?.timezone ?? browserTimeZone()} onChange={(v) => void saveSettings({ timezone: v })} />
              </div>
              {settings?.timezone && <button type="button" className="btn btn-sm" onClick={() => void saveSettings({ timezone: null })}>Use browser’s</button>}
            </div>
            <span className="hint">{settings?.timezone ? `Overridden. Your browser reports ${browserTimeZone()}.` : `Following your browser (${browserTimeZone()}).`} Each deadline also keeps the zone it was entered in.</span>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>Default reminders for new assessments</legend>
            <div className="chips">
              {OFFSET_CHOICES.map((o) => (
                <button key={o} type="button" className="chip-toggle" aria-pressed={offsets.includes(o)} onClick={() => void saveSettings({ defaultReminderOffsetsMinutes: offsets.includes(o) ? offsets.filter((x) => x !== o) : [...offsets, o].sort((a, b) => b - a) })}>
                  {describeOffset(o)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="banner" role="note">
          <span>
            Browser notifications come from the paired extension and depend on Chrome running and your OS allowing notifications. If Chrome is closed or the computer is asleep, a reminder can’t arrive on time — you’ll get one catch-up notice when Chrome next runs, if the deadline hasn’t passed. The “OA &amp; HireVue up next” list on the Applications page is always the source of truth.
          </span>
        </div>
      </section>

      <section className="card card-pad stack" aria-labelledby="pair-h">
        <h2 id="pair-h" style={{ fontSize: 20 }}>Browser extension pairing</h2>
        <p className="small muted">Pairing lets the extension save captures here. The extension gets its own key, stored only in the extension; it can save and link jobs but can’t read your documents, delete records or make backups.</p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={offline} onClick={async () => { try { setCode(await api.pairingCode()); } catch (e) { notify(reportError(e), 'error'); } }}>
            {code ? 'Generate a new code' : 'Generate pairing code'}
          </button>
          {code && (
            <>
              <span className="pair-code" aria-label={`Pairing code ${code.code.split('').join(' ')}`}>{code.code}</span>
              <span className="small muted">Enter it in the extension’s side panel. Expires {formatDateTime(code.expiresAt, tz)}; works once.</span>
            </>
          )}
        </div>
        {pairings.length > 0 ? (
          <ul className="link-list">
            {pairings.map((p) => (
              <li key={p.id} className="link-item">
                <span className="grow">
                  <span style={{ fontWeight: 650 }}>{p.name ?? 'Chrome extension'}</span>
                  <span className="small muted">
                    Paired {formatDateTime(p.createdAt, tz)} · last seen {p.lastSeenAt ? formatDateTime(p.lastSeenAt, tz) : 'never'} · reminders synced {p.lastReminderSyncAt ? formatDateTime(p.lastReminderSyncAt, tz) : 'never'}
                  </span>
                  <span className="small muted mono truncate">{p.origin}</span>
                </span>
                <button type="button" className="btn btn-sm btn-danger" onClick={async () => { await api.revokePairing(p.id); refresh(); notify('Pairing removed'); }}>Unpair</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small">No extension is paired.</p>
        )}
        {pairings.length > 0 && <button type="button" className="btn btn-sm" style={{ justifySelf: 'start' }} onClick={() => setResetting(true)}>Reset all pairings…</button>}
        <p className="small muted">Reinstalled the unpacked extension and its ID changed? Just pair again — each extension ID needs its own pairing.</p>
      </section>

      <section className="card card-pad stack" aria-labelledby="bk-h">
        <h2 id="bk-h" style={{ fontSize: 20 }}>Backup &amp; export</h2>
        <div className="grid-2">
          <div className="stack-sm">
            <h3 style={{ fontSize: 16 }}>Complete backup (.zip)</h3>
            <p className="small muted">All records, saved JDs, links, activity, and the original resume/cover-letter files, with a manifest of SHA-256 hashes. Pairing keys are not included.</p>
            <div className="banner warn"><span>The archive contains your personal documents. Store it somewhere private.</span></div>
            <a className={`btn btn-primary${offline ? ' disabled' : ''}`} style={{ justifySelf: 'start' }} href={urls.backup} download aria-disabled={offline}>Download full backup</a>
          </div>
          <div className="stack-sm">
            <h3 style={{ fontSize: 16 }}>Spreadsheet overview (.csv)</h3>
            <p className="small muted">One row per application for Excel or Google Sheets. <strong>Not a backup</strong>: no JD text or files.</p>
            <a className="btn" style={{ justifySelf: 'start' }} href={urls.csv} download>Download CSV</a>
          </div>
        </div>
      </section>

      <section className="card card-pad stack" aria-labelledby="rs-h">
        <h2 id="rs-h" style={{ fontSize: 20 }}>Restore from backup</h2>
        <p className="small muted">The archive is checked first (paths, sizes, hashes, references, schema version). Nothing changes until you confirm.</p>
        {!staged ? (
          <div className="field" style={{ maxWidth: 460 }}>
            <label htmlFor="restore-file">Choose an Appfolio backup (.zip)</label>
            <input
              id="restore-file"
              ref={fileRef}
              type="file"
              className="input"
              accept=".zip,application/zip"
              disabled={restoreBusy || offline}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setRestoreBusy(true);
                setRestoreError(null);
                try {
                  setStaged(await api.stageRestore(f));
                } catch (err) {
                  setRestoreError(reportError(err));
                } finally {
                  setRestoreBusy(false);
                  if (fileRef.current) fileRef.current.value = '';
                }
              }}
            />
            {restoreBusy && <span className="small muted" role="status"><span className="spinner" /> Checking archive…</span>}
          </div>
        ) : (
          <div className="stack">
            <div className="banner ok" role="status">
              <span>
                <strong>Backup verified.</strong> Created {formatDateTime(staged.createdAt, tz)} · schema v{staged.schemaVersion} · {formatBytes(staged.documentBytes)} of documents.
              </span>
            </div>
            <dl className="kv small" style={{ gridTemplateColumns: '160px 1fr', maxWidth: 420 }}>
              {Object.entries(TABLE_LABELS).map(([k, label]) => (
                <div key={k} style={{ display: 'contents' }}><dt>{label}</dt><dd>{staged.counts[k] ?? 0}</dd></div>
              ))}
            </dl>
            {staged.warnings.map((w) => <div key={w} className="banner warn"><span>{w}</span></div>)}
            {staged.currentWorkspaceEmpty ? (
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={restoreBusy} onClick={async () => {
                  setRestoreBusy(true);
                  try {
                    await api.applyRestore(staged.stagingId, 'empty');
                    setStaged(null);
                    refresh();
                    notify('Backup restored');
                  } catch (err) { setRestoreError(reportError(err)); } finally { setRestoreBusy(false); }
                }}>Restore into this empty workspace</button>
                <button type="button" className="btn" onClick={() => { void api.discardRestore(staged.stagingId); setStaged(null); }}>Cancel</button>
              </div>
            ) : (
              <div className="stack-sm">
                <div className="banner warn" role="alert">
                  <span>
                    <strong>This workspace isn’t empty</strong> ({summary?.totalRecords ?? '?'} records). Restoring <strong>replaces everything</strong> here with the backup. A recovery backup of the current workspace is saved first to <span className="code">{status?.dataDir}/backups/</span>. Merging isn’t supported.
                  </span>
                </div>
                <div className="field" style={{ maxWidth: 340 }}>
                  <label htmlFor="replace-confirm">Type REPLACE to confirm</label>
                  <input id="replace-confirm" className="input" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} autoComplete="off" />
                </div>
                <div className="row">
                  <button type="button" className="btn btn-danger-solid" disabled={replaceText !== 'REPLACE' || restoreBusy} onClick={async () => {
                    setRestoreBusy(true);
                    try {
                      const r = await api.applyRestore(staged.stagingId, 'replace', replaceText);
                      setStaged(null);
                      setReplaceText('');
                      refresh();
                      notify(`Workspace replaced. Recovery backup saved to ${r.recoveryBackup}`);
                    } catch (err) { setRestoreError(reportError(err)); } finally { setRestoreBusy(false); }
                  }}>{restoreBusy ? 'Replacing…' : 'Replace current workspace'}</button>
                  <button type="button" className="btn" onClick={() => { void api.discardRestore(staged.stagingId); setStaged(null); setReplaceText(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {restoreError && <div className="banner error" role="alert"><span><strong>Restore stopped.</strong> {restoreError} Your current data was not changed.</span></div>}
      </section>

      <section className="card card-pad stack" aria-labelledby="demo-h">
        <h2 id="demo-h" style={{ fontSize: 20 }}>Demo data</h2>
        {summary?.hasDemoData ? (
          <>
            <p className="small muted">This workspace contains fictional demo records (marked “Demo”).</p>
            <button type="button" className="btn btn-danger" style={{ justifySelf: 'start' }} onClick={() => setRemoveDemo(true)}>Remove demo data</button>
          </>
        ) : summary?.totalRecords === 0 ? (
          <>
            <p className="small muted">Load a few clearly fictional records to explore the dashboard. Only possible in an empty workspace, so it never mixes with real applications.</p>
            <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={async () => { try { await api.seedDemo(tz); refresh(); notify('Demo data loaded'); } catch (e) { notify(reportError(e), 'error'); } }}>Load demo data</button>
          </>
        ) : (
          <p className="small muted">Demo data can only be loaded into an empty workspace.</p>
        )}
      </section>

      <section className="card card-pad stack-sm" aria-labelledby="data-h">
        <h2 id="data-h" style={{ fontSize: 20 }}>Where your data is</h2>
        <dl className="kv small">
          <dt>Data directory</dt><dd className="mono">{status?.dataDir ?? '…'}</dd>
          <dt>Stored documents</dt><dd>{status?.storage.documents ?? '…'}</dd>
          <dt>Schema version</dt><dd>{status?.schemaVersion ?? '…'}</dd>
          <dt>App version</dt><dd>{status?.version ?? '…'}</dd>
          <dt>Upload limit</dt><dd>{status ? formatBytes(status.maxUploadBytes) : '…'}</dd>
        </dl>
        {status && status.storage.missingFiles > 0 && (
          <div className="banner error" role="alert"><span><strong>{status.storage.missingFiles} stored file(s) are missing</strong> from the data directory. Downloads for them will fail. Restore from a backup to recover them.</span></div>
        )}
        {status && status.storage.orphanFilesRemoved > 0 && (
          <div className="banner"><span>At startup, {status.storage.orphanFilesRemoved} unreferenced file(s) from an interrupted upload were moved to <span className="code">orphaned/</span> in the data directory.</span></div>
        )}
        <p className="small muted">Change it by starting Appfolio with <span className="code">--data-dir &lt;path&gt;</span> or <span className="code">APPFOLIO_DATA_DIR</span>. The server only listens on 127.0.0.1.</p>
      </section>

      {resetting && (
        <ConfirmDialog title="Reset all pairings?" confirmLabel="Reset pairings" danger onClose={() => setResetting(false)} onConfirm={async () => { await api.revokePairing('all'); setResetting(false); refresh(); notify('All pairings reset'); }}>
          <p>Every paired extension stops working until you pair it again with a new code. Queued captures stay in the extension and send once it’s paired again.</p>
        </ConfirmDialog>
      )}
      {removeDemo && (
        <ConfirmDialog title="Remove demo data?" confirmLabel="Remove demo data" danger onClose={() => setRemoveDemo(false)} onConfirm={async () => { await api.removeDemo(); setRemoveDemo(false); refresh(); notify('Demo data removed'); }}>
          <p>Deletes every record and file marked “Demo”. Your own records aren’t touched.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
