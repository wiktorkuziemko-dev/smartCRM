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

export const MAX_RANGE_DAYS = 366;

/**
 * Zakres dni (YYYY-MM-DD, włącznie) → momenty od początku pierwszego dnia do końca ostatniego
 * (dla dzisiejszego dnia – do teraz). Zwraca komunikat błędu, gdy zakres jest niepoprawny.
 */
export function dayRange(fromDay: string, toDay: string): { from: Date; to: Date; days: number; untilNow: boolean } | string {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromDay) || !re.test(toDay) || Number.isNaN(Date.parse(fromDay)) || Number.isNaN(Date.parse(toDay))) return 'Niepoprawna data';
  if (fromDay > toDay) return 'Data początkowa jest późniejsza niż końcowa';
  const today = todayInTz();
  if (fromDay > today) return 'Okres nie może zaczynać się w przyszłości';
  const lastDay = toDay > today ? today : toDay;
  const days = Math.round((Date.parse(lastDay) - Date.parse(fromDay)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `Okres może obejmować najwyżej ${MAX_RANGE_DAYS} dni`;
  const untilNow = lastDay === today;
  const to = untilNow ? new Date() : zonedDate(addDays(lastDay, 1), '00:00');
  return { from: zonedDate(fromDay, '00:00'), to, days, untilNow };
}
