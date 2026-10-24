import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns';
import { pl } from 'date-fns/locale';

export const fmtDate = (d: string | Date) => format(new Date(d), 'd MMM yyyy', { locale: pl });
export const fmtDateTime = (d: string | Date) => format(new Date(d), 'd MMM yyyy, HH:mm', { locale: pl });
export const fmtAgo = (d: string | Date) => formatDistanceToNow(new Date(d), { locale: pl, addSuffix: true });

export function fmtDue(d: string) {
  const date = new Date(d);
  const time = format(date, 'HH:mm');
  if (isToday(date)) return `Dziś, ${time}`;
  if (isTomorrow(date)) return `Jutro, ${time}`;
  return format(date, 'd MMM, HH:mm', { locale: pl });
}

export const isOverdue = (d: string) => isPast(new Date(d));

export const fmtNip = (nip: string | null) =>
  nip && nip.length === 10 ? `${nip.slice(0, 3)}-${nip.slice(3, 6)}-${nip.slice(6, 8)}-${nip.slice(8)}` : nip ?? '';

export const fmtNumber = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('pl-PL'));

export const fmtSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Wartość dla <input type="datetime-local"> w czasie lokalnym. */
export const toLocalInput = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

/** Termin z pola datetime-local leży w przeszłości (z dokładnością do minuty). */
export function isPastInput(value: string) {
  const startOfMinute = new Date();
  startOfMinute.setSeconds(0, 0);
  return Boolean(value) && new Date(value) < startOfMinute;
}

export const initials = (name: string | null | undefined) =>
  (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

/** Link "Dodaj do Kalendarza Google" – działa bez żadnej konfiguracji serwera. */
export function googleCalendarLink(title: string, due: string, details = '') {
  const start = new Date(due);
  const end = new Date(start.getTime() + 30 * 60_000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const qs = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(start)}/${f(end)}`, details });
  return `https://calendar.google.com/calendar/render?${qs}`;
}
