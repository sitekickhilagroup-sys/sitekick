// The app's canonical calendar day is Los Angeles (Hilla Group ops timezone).
// Every persisted "today" date must use this — never toISOString().slice(0,10),
// which is UTC and rolls to tomorrow at 4-5pm PT.
export function laToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

/**
 * Formats a stored instant (activity_log.created_at, a UTC timestamptz) as
 * LA-local "YYYY-MM-DD HH:mm" — the same civil timezone laToday() uses for
 * every persisted "today", now applied to display an already-stored instant
 * (E5's per-invoice change-history panel) instead of stamping a new one.
 */
export function laDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
