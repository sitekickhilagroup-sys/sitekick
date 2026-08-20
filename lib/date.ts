// The app's canonical calendar day is Los Angeles (Hilla Group ops timezone).
// Every persisted "today" date must use this — never toISOString().slice(0,10),
// which is UTC and rolls to tomorrow at 4-5pm PT.
export function laToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}
