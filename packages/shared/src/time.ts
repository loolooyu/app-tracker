/**
 * Time-zone helpers built on Intl only (no external tz library).
 * Deadlines are stored as a UTC instant plus the IANA zone the user entered them in.
 */

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of an instant in a zone. */
export function wallTimeInZone(instant: Date, tz: string): WallTime & { second: number } {
  const parts = partsFormatter(tz).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (e.g. -4h for EDT). */
export function zoneOffsetMs(instant: Date, tz: string): number {
  const w = wallTimeInZone(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

export type WallTimeResolution = 'exact' | 'gap' | 'ambiguous';

export interface ZonedConversion {
  instant: Date;
  /**
   * exact: the wall time exists once.
   * gap: the wall time does not exist (DST spring-forward); moved forward by the gap.
   * ambiguous: the wall time occurs twice (DST fall-back); the first occurrence was chosen.
   */
  resolution: WallTimeResolution;
}

/** Convert a wall-clock time in an IANA zone to a UTC instant, handling DST gaps and overlaps explicitly. */
export function zonedWallTimeToUtc(wall: WallTime, tz: string): ZonedConversion {
  if (!isValidTimeZone(tz)) throw new Error(`Unknown time zone: ${tz}`);
  const wallMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  const offsets = new Set<number>([
    zoneOffsetMs(new Date(wallMs - 36 * 3600_000), tz),
    zoneOffsetMs(new Date(wallMs), tz),
    zoneOffsetMs(new Date(wallMs + 36 * 3600_000), tz),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const t = wallMs - off;
    const back = wallTimeInZone(new Date(t), tz);
    if (
      back.year === wall.year &&
      back.month === wall.month &&
      back.day === wall.day &&
      back.hour === wall.hour &&
      back.minute === wall.minute
    ) {
      matches.push(t);
    }
  }
  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (unique.length === 1) return { instant: new Date(unique[0]), resolution: 'exact' };
  if (unique.length > 1) return { instant: new Date(unique[0]), resolution: 'ambiguous' };
  // Gap: use the offset in effect just before the transition, which lands after the gap.
  const before = zoneOffsetMs(new Date(wallMs - 36 * 3600_000), tz);
  return { instant: new Date(wallMs - before), resolution: 'gap' };
}

/** Parse `YYYY-MM-DD` and `HH:mm` strings (as produced by <input type=date/time>). */
export function parseDateAndTime(date: string, time: string): WallTime | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;
  const wall = { year: +d[1], month: +d[2], day: +d[3], hour: +t[1], minute: +t[2] };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 23 || wall.minute > 59) return null;
  // Reject impossible dates like 2026-02-31.
  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  if (check.getUTCMonth() !== wall.month - 1) return null;
  return wall;
}

/** Inverse of parseDateAndTime: the date/time input values for an instant viewed in a zone. */
export function toDateAndTimeInputs(instant: Date, tz: string): { date: string; time: string } {
  const w = wallTimeInZone(instant, tz);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${w.year}-${p(w.month)}-${p(w.day)}`, time: `${p(w.hour)}:${p(w.minute)}` };
}

export function formatInZone(instant: Date | string, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...opts,
  }).format(d);
}

/** Short zone name such as "EDT" or "GMT+9" at a given instant. */
export function zoneAbbreviation(instant: Date | string, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

export function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length) return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    // fall through
  }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Shanghai'];
}

/** Human description of time until/since an instant, e.g. "in 3 h", "2 d overdue". */
export function relativeDue(dueAt: Date | string, now: Date = new Date()): { text: string; overdue: boolean } {
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const diff = due.getTime() - now.getTime();
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  let span: string;
  if (mins < 60) span = `${mins} min`;
  else if (mins < 48 * 60) span = `${Math.round(mins / 60)} h`;
  else span = `${Math.round(mins / 1440)} d`;
  return { text: overdue ? `${span} overdue` : `in ${span}`, overdue };
}
