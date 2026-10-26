import { CalendarRange } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'custom';
export interface Period { key: PeriodKey; from: string; to: string }

const PRESETS: { key: Exclude<PeriodKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Dziś' },
  { key: 'yesterday', label: 'Wczoraj' },
  { key: 'week', label: 'Ostatnie 7 dni' },
];

const day = (d: Date) => format(d, 'yyyy-MM-dd');

/** Okres (dni od–do, włącznie) dla gotowego wyboru. */
export function presetPeriod(key: Exclude<PeriodKey, 'custom'>): Period {
  const today = new Date();
  if (key === 'yesterday') return { key, from: day(addDays(today, -1)), to: day(addDays(today, -1)) };
  if (key === 'week') return { key, from: day(addDays(today, -6)), to: day(today) };
  return { key, from: day(today), to: day(today) };
}

export const isValidPeriod = (p: Period) => Boolean(p.from && p.to && p.from <= p.to);

/** Opis okresu do nagłówków, np. „1.10.2026 – 26.10.2026”. */
export function periodLabel(p: Period) {
  if (p.key !== 'custom') return PRESETS.find((x) => x.key === p.key)!.label.toLowerCase();
  const f = (s: string) => format(parseISO(s), 'd.MM.yyyy');
  return p.from === p.to ? f(p.from) : `${f(p.from)} – ${f(p.to)}`;
}

/** Wybór okresu: Dziś / Wczoraj / Ostatnie 7 dni / dowolny okres (dwie daty). */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const today = day(new Date());
  const btn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition ${active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => onChange(presetPeriod(p.key))} className={btn(value.key === p.key)}>{p.label}</button>
        ))}
        <button onClick={() => value.key !== 'custom' && onChange({ key: 'custom', from: day(addDays(new Date(), -29)), to: today })}
          className={btn(value.key === 'custom')} title="Wybierz dowolny okres">
          <CalendarRange size={14} /> Okres
        </button>
      </div>
      {value.key === 'custom' && (
        <div className="inline-flex items-center gap-1.5 text-sm text-slate-500">
          <input type="date" className="input w-auto py-1 text-sm" value={value.from} max={value.to || today}
            onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Od dnia" />
          <span>–</span>
          <input type="date" className="input w-auto py-1 text-sm" value={value.to} min={value.from} max={today}
            onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Do dnia" />
        </div>
      )}
    </div>
  );
}
