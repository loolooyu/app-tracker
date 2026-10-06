import { useEffect, useRef } from 'react';
import { IconApps, IconDoc, IconFlow, IconGear } from './components/Icons';
import { useApp } from './lib/app-context';
import { href, useRoute, type Route } from './lib/route';
import { ApplicationsView } from './views/ApplicationsView';
import { ResumeLibraryView } from './views/ResumeLibraryView';
import { SettingsView } from './views/SettingsView';
import { WorkflowView } from './views/WorkflowView';

const NAV: Array<{ route: Route; label: string; short?: string; icon: typeof IconApps }> = [
  { route: { view: 'applications', id: null }, label: 'Applications', icon: IconApps },
  { route: { view: 'workflow' }, label: 'Your Workflow', short: 'Workflow', icon: IconFlow },
  { route: { view: 'resumes' }, label: 'Resume Library', short: 'Resumes', icon: IconDoc },
  { route: { view: 'settings' }, label: 'Settings & Backup', short: 'Settings', icon: IconGear },
];

const TITLES: Record<Route['view'], string> = {
  applications: 'Applications',
  workflow: 'Your Workflow',
  resumes: 'Resume Library',
  settings: 'Settings & Backup',
};

export function App() {
  const route = useRoute();
  const { connection, status } = useApp();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = `${TITLES[route.view]} · Appfolio`;
  }, [route.view]);

  const paired = (status?.pairings.length ?? 0) > 0;
  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <a className="wordmark" href={href({ view: 'applications', id: null })} aria-label="Appfolio home">
          <span className="wordmark-mark" aria-hidden="true">A</span>
          <span className="wordmark-text">Appfolio</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => {
            const active = n.route.view === route.view;
            const Icon = n.icon;
            return (
              <a key={n.label} href={href(n.route)} aria-current={active ? 'page' : undefined}>
                <Icon />
                {n.short ? (
                  <>
                    <span className="nav-label-long">{n.label}</span>
                    <span className="nav-label-short">{n.short}</span>
                  </>
                ) : (
                  <span>{n.label}</span>
                )}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-foot" aria-live="polite">
          <span className="conn">
            <span className={`dot ${connection === 'online' ? 'ok' : connection === 'offline' ? 'bad' : ''}`} aria-hidden="true" />
            {connection === 'online' ? 'Local server connected' : connection === 'offline' ? 'Local server offline' : 'Connecting…'}
          </span>
          <span className="conn">
            <span className={`dot ${paired ? 'ok' : ''}`} aria-hidden="true" />
            {paired ? 'Extension paired' : 'Extension not paired'}
          </span>
          <span>Stored only on this computer.</span>
        </div>
      </aside>
      <main id="main" className="main" ref={mainRef} tabIndex={-1}>
        {connection === 'offline' && (
          <div className="banner error" role="alert">
            <span>
              <strong>Can’t reach the local Appfolio server.</strong> Your data is safe on disk. Start the server with <span className="code">npm start</span> in the project folder, then this page reconnects automatically.
            </span>
          </div>
        )}
        {route.view === 'applications' && <ApplicationsView selectedId={route.id} />}
        {route.view === 'workflow' && <WorkflowView />}
        {route.view === 'resumes' && <ResumeLibraryView />}
        {route.view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
