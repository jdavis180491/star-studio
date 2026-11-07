// "Today" is the family's local day, not the server's (Replit servers run on UTC).
const TZ = process.env.APP_TIMEZONE || 'Europe/London';

export function dayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isISODate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Day of week for an ISO date: 0 = Sunday … 6 = Saturday. */
export function weekday(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** Monday of the week containing `iso` (the league resets every Monday). */
export function weekStartISO(iso = dayISO()) {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

/** The family's local hour (0-23). */
export function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(date));
}

export const PREMIERE_HOUR = 18;
