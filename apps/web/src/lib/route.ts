import { useEffect, useState } from 'react';

export type Route =
  | { view: 'applications'; id: string | null }
  | { view: 'workflow' }
  | { view: 'resumes' }
  | { view: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'workflow':
      return { view: 'workflow' };
    case 'resumes':
      return { view: 'resumes' };
    case 'settings':
      return { view: 'settings' };
    case 'applications':
      return { view: 'applications', id: parts[1] ? decodeURIComponent(parts[1]) : null };
    default:
      return { view: 'applications', id: null };
  }
}

export function href(route: Route): string {
  if (route.view === 'applications') return route.id ? `#/applications/${encodeURIComponent(route.id)}` : '#/applications';
  return `#/${route.view}`;
}

export function navigate(route: Route) {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
