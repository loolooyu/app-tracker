import { PLATFORM_LABELS, STATUS_LABELS, formatInZone, zoneAbbreviation, type Platform, type Status } from '@appfolio/shared';

export const platformLabel = (p: Platform | null | undefined) => (p ? PLATFORM_LABELS[p] : '—');
export const statusLabel = (s: Status) => STATUS_LABELS[s];

export function formatDate(iso: string | null | undefined, tz: string) {
  if (!iso) return '—';
  return formatInZone(iso, tz, { dateStyle: 'medium', timeStyle: undefined });
}

export function formatDateTime(iso: string | null | undefined, tz: string) {
  if (!iso) return '—';
  return `${formatInZone(iso, tz)} ${zoneAbbreviation(iso, tz)}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Only http(s) links are rendered as clickable. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
