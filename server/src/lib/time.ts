import { config } from '../config.js';

/** Dzisiejsza data (YYYY-MM-DD) w strefie aplikacji. */
export const todayInTz = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());

/** Data przesunięta o n dni (YYYY-MM-DD). */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dzień i godzina w strefie aplikacji (np. 09:00 w Warszawie) jako moment w czasie (z uwzględnieniem zmiany czasu). */
export function zonedDate(day: string, hhmm: string) {
  const guess = new Date(`${day}T${hhmm}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess).map((p) => [p.type, p.value]));
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (local - guess.getTime()));
}
