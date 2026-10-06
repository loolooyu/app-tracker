import { useEffect, useId, useMemo, useState } from 'react';
import { formatInZone, parseDateAndTime, supportedTimeZones, toDateAndTimeInputs, zoneAbbreviation, zonedWallTimeToUtc } from '@appfolio/shared';

export function TimezoneSelect({ id, value, onChange }: { id?: string; value: string; onChange: (tz: string) => void }) {
  const zones = useMemo(() => {
    const all = supportedTimeZones();
    return all.includes(value) ? all : [value, ...all];
  }, [value]);
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

export interface DateTimeValue {
  iso: string | null;
  timezone: string;
  /** True when the user typed a date but no time yet. */
  incomplete: boolean;
}

interface Props {
  label: string;
  initialIso: string | null;
  initialTimezone: string;
  /** The zone the dashboard displays times in, used for the "your time" preview. */
  displayTimezone: string;
  required?: boolean;
  defaultTime?: string;
  onChange: (v: DateTimeValue) => void;
}

/**
 * Date + time + explicit IANA zone. The deadline is stored as a UTC instant plus the zone it
 * was entered in. A date without a time is never silently interpreted.
 */
export function DateTimeField({ label, initialIso, initialTimezone, displayTimezone, required, defaultTime = '23:59', onChange }: Props) {
  const id = useId();
  const initial = initialIso ? toDateAndTimeInputs(new Date(initialIso), initialTimezone) : { date: '', time: '' };
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [tz, setTz] = useState(initialTimezone);

  const result = useMemo(() => {
    if (!date && !time) return { iso: null, note: null as string | null, error: required ? 'Required' : null, incomplete: false };
    if (date && !time) return { iso: null, note: null, error: 'Add a time. A date alone is ambiguous for a deadline.', incomplete: true };
    if (!date && time) return { iso: null, note: null, error: 'Add a date.', incomplete: true };
    const wall = parseDateAndTime(date, time);
    if (!wall) return { iso: null, note: null, error: 'That date or time is not valid.', incomplete: true };
    const conv = zonedWallTimeToUtc(wall, tz);
    let note: string | null = null;
    if (conv.resolution === 'gap') note = `That time doesn’t exist in ${tz} (clocks spring forward). Saved as ${formatInZone(conv.instant, tz, { timeStyle: 'short', dateStyle: undefined })} ${zoneAbbreviation(conv.instant, tz)}.`;
    if (conv.resolution === 'ambiguous') note = `That time happens twice in ${tz} (clocks fall back). Using the first occurrence, ${zoneAbbreviation(conv.instant, tz)}.`;
    return { iso: conv.instant.toISOString(), note, error: null, incomplete: false };
  }, [date, time, tz, required]);

  useEffect(() => {
    onChange({ iso: result.iso, timezone: tz, incomplete: result.incomplete });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.iso, tz, result.incomplete]);

  const showPreview = result.iso && tz !== displayTimezone;
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label" style={{ fontWeight: 600, fontSize: 13, marginBottom: 5 }}>
        {label}
        {required ? ' *' : ''}
      </legend>
      <div className="grid-3">
        <div className="field">
          <label htmlFor={`${id}-d`} className="small muted">Date</label>
          <input id={`${id}-d`} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!result.error && !!date && !time} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-t`} className="small muted">Time</label>
          <input id={`${id}-t`} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={!!date && !time} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-z`} className="small muted">Time zone</label>
          <TimezoneSelect id={`${id}-z`} value={tz} onChange={setTz} />
        </div>
      </div>
      {result.error && (date || time) && (
        <div className="row">
          <span className="error-text" role="alert">{result.error}</span>
          {date && !time && (
            <button type="button" className="btn btn-sm" onClick={() => setTime(defaultTime)}>
              Use {defaultTime === '23:59' ? '11:59 PM' : defaultTime}
            </button>
          )}
        </div>
      )}
      {result.note && <span className="hint" role="note">{result.note}</span>}
      {showPreview && (
        <span className="hint">
          That’s {formatInZone(result.iso!, displayTimezone)} {zoneAbbreviation(result.iso!, displayTimezone)} in your time zone ({displayTimezone.replace(/_/g, ' ')}).
        </span>
      )}
      {!date && !time && <span className="hint">Enter the deadline in the time zone the company gave you. If they didn’t give one, confirm with them rather than guessing.</span>}
    </fieldset>
  );
}
