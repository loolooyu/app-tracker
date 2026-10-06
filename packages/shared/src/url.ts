import type { Platform } from './constants.js';

/**
 * Query parameters known to be tracking-only. Everything else is kept, because many job
 * boards identify the posting with a query parameter (gh_jid, currentJobId, jobId, ...).
 */
const TRACKING_PARAMS = new Set([
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  '_hsenc',
  '_hsmi',
  'hsctatracking',
  'trk',
  'trkinfo',
  'trackingid',
  'refid',
  'lipi',
  'midtoken',
  'midsig',
  'eid',
  'otptoken',
  'ebp',
  'recommendedflavor',
  'gh_src',
  'lever-source',
  'lever-origin',
  'ref_src',
  'spm',
]);

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n);
}

/**
 * Normalized form used only for matching. The original URL is always stored as-is.
 * - lowercases scheme and host, drops default ports and `www.`
 * - drops the fragment and known tracking parameters, sorts the rest
 * - drops a trailing slash
 */
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const port = u.port && !['80', '443'].includes(u.port) ? `:${u.port}` : '';
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = params.length ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
  let path = u.pathname.replace(/\/+$/, '');
  if (!path) path = '';
  return `${u.protocol.toLowerCase()}//${host}${port}${path}${query}`;
}

export function hostnameOf(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
  return host === d || host.endsWith('.' + d);
}

export interface PlatformConfig {
  /** Hostnames the user has told us are NUworks. We never guess NUworks' authenticated hostname. */
  nuworksHosts?: string[];
}

export function detectPlatform(url: string, config: PlatformConfig = {}): Platform {
  const host = hostnameOf(url);
  if (!host) return 'other';
  for (const h of config.nuworksHosts ?? []) {
    if (h.trim() && hostMatches(host, h.trim())) return 'nuworks';
  }
  if (hostMatches(host, 'linkedin.com')) return 'linkedin';
  if (hostMatches(host, 'joinhandshake.com')) return 'handshake';
  if (hostMatches(host, 'greenhouse.io')) return 'greenhouse';
  if (hostMatches(host, 'myworkdayjobs.com') || hostMatches(host, 'myworkdaysite.com') || hostMatches(host, 'workday.com')) return 'workday';
  if (host === 'localhost' || host === '127.0.0.1') return 'other';
  return 'company';
}

/** Platform-specific job identifiers derivable from the URL alone. */
export function jobIdFromUrl(url: string, platform: Platform): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.pathname;
  switch (platform) {
    case 'greenhouse': {
      const q = u.searchParams.get('gh_jid');
      if (q && /^\d+$/.test(q)) return q;
      const m = /\/jobs\/(\d+)/.exec(path);
      return m ? m[1] : null;
    }
    case 'linkedin': {
      const q = u.searchParams.get('currentJobId');
      if (q && /^\d+$/.test(q)) return q;
      const m = /\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/.exec(path);
      return m ? m[1] : null;
    }
    case 'workday': {
      // e.g. /en-US/careers/job/Boston-MA/Software-Engineer-Co-op_R0123456
      const m = /_((?:JR|R|REQ)[-_]?\d{3,}[\w-]*)\/?$/i.exec(path);
      return m ? m[1] : null;
    }
    case 'handshake': {
      const m = /\/(?:jobs|job-search)\/(\d+)/.exec(path);
      return m ? m[1] : null;
    }
    default: {
      for (const key of ['gh_jid', 'jobId', 'jobid', 'job_id', 'jid', 'reqId', 'requisitionId']) {
        const v = u.searchParams.get(key);
        if (v && v.length <= 64) return v;
      }
      return null;
    }
  }
}
