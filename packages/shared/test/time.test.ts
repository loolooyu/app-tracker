import { describe, expect, it } from 'vitest';
import { parseDateAndTime, toDateAndTimeInputs, zonedWallTimeToUtc, relativeDue } from '../src/time.js';

const wall = (s: string) => {
  const [d, t] = s.split(' ');
  return parseDateAndTime(d, t)!;
};

describe('zonedWallTimeToUtc', () => {
  it('converts a deadline entered in another zone to the correct instant', () => {
    expect(zonedWallTimeToUtc(wall('2026-10-20 23:59'), 'America/Los_Angeles').instant.toISOString()).toBe('2026-10-21T06:59:00.000Z');
    expect(zonedWallTimeToUtc(wall('2026-10-20 23:59'), 'America/New_York').instant.toISOString()).toBe('2026-10-21T03:59:00.000Z');
    expect(zonedWallTimeToUtc(wall('2026-10-20 09:00'), 'Asia/Kolkata').instant.toISOString()).toBe('2026-10-20T03:30:00.000Z');
  });

  it('uses the offset in effect on each side of a DST change', () => {
    // US DST ends 2026-11-01. Before: EDT (UTC-4); after: EST (UTC-5).
    expect(zonedWallTimeToUtc(wall('2026-10-31 12:00'), 'America/New_York').instant.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(zonedWallTimeToUtc(wall('2026-11-02 12:00'), 'America/New_York').instant.toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('moves a nonexistent spring-forward time forward and says so', () => {
    // 2027-03-14 02:30 does not exist in New York.
    const r = zonedWallTimeToUtc(wall('2027-03-14 02:30'), 'America/New_York');
    expect(r.resolution).toBe('gap');
    expect(r.instant.toISOString()).toBe('2027-03-14T07:30:00.000Z'); // 03:30 EDT
  });

  it('picks the first occurrence of an ambiguous fall-back time and says so', () => {
    const r = zonedWallTimeToUtc(wall('2026-11-01 01:30'), 'America/New_York');
    expect(r.resolution).toBe('ambiguous');
    expect(r.instant.toISOString()).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT
  });

  it('round-trips through the input representation', () => {
    const instant = new Date('2026-12-01T15:45:00Z');
    const { date, time } = toDateAndTimeInputs(instant, 'Europe/Berlin');
    expect({ date, time }).toEqual({ date: '2026-12-01', time: '16:45' });
    expect(zonedWallTimeToUtc(wall(`${date} ${time}`), 'Europe/Berlin').instant.toISOString()).toBe(instant.toISOString());
  });

  it('rejects impossible dates and unknown zones', () => {
    expect(parseDateAndTime('2026-02-31', '10:00')).toBeNull();
    expect(parseDateAndTime('2026-02-10', '')).toBeNull();
    expect(() => zonedWallTimeToUtc(wall('2026-02-10 10:00'), 'Mars/Olympus')).toThrow();
  });
});

describe('relativeDue', () => {
  it('describes upcoming and overdue', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    expect(relativeDue('2026-10-06T15:00:00Z', now)).toEqual({ text: 'in 3 h', overdue: false });
    expect(relativeDue('2026-10-04T12:00:00Z', now)).toEqual({ text: '2 d overdue', overdue: true });
  });
});
