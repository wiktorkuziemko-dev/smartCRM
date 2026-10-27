import { useState } from 'react';
import { Clock, CalendarDays } from 'lucide-react';
import { fmtNumber } from '../lib/format';
import { PeriodPicker, periodLabel, type Period } from './PeriodPicker';

export interface DriveProfile { hourSec: number[]; weekdayKm: number[] }
interface Person { userId: number; fullName: string; profile: DriveProfile | null }

const WORK_FROM = 7;
const WORK_TO = 17;
const DAY_NAMES = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'];
const DAY_FULL = ['poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty', 'niedziele'];
// Kolory serii (sprawdzone walidatorem palety: rozróżnialne także przy daltonizmie).
const BLUE = '#2563eb';
const ORANGE = '#eb6834';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const hoursLabel = (sec: number) => {
  const h = sec / 3600;
  return h >= 10 ? `${fmtNumber(Math.round(h))} h` : `${fmtNumber(Math.round(h * 10) / 10)} h`;
};

/** „Ładna” górna granica osi i podziałka (np. 0 / 50 / 100 / 150). */
function niceScale(max: number) {
  if (max <= 0) return { top: 1, ticks: [0] };
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** Rozkład jazdy pod mapą: godziny doby i dni tygodnia – zespół lub wybrany handlowiec. */
export function DriveCharts({ people, weekdayDays, period, onPeriod, loading }: {
  people: Person[]; weekdayDays: number[]; period: Period; onPeriod: (p: Period) => void; loading?: boolean;
}) {
  const [who, setWho] = useState<number | 'all'>('all');
  const withData = people.filter((p) => p.profile);
  const selected = who === 'all' ? withData : withData.filter((p) => p.userId === who);
  const hourSec = Array.from({ length: 24 }, (_, i) => sum(selected.map((p) => p.profile!.hourSec[i])));
  const weekdayKm = Array.from({ length: 7 }, (_, i) => sum(selected.map((p) => p.profile!.weekdayKm[i])));

  return (
    <div className="border-t border-slate-100 px-5 pt-4 pb-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="mr-auto text-sm font-semibold text-slate-700">Rozkład jazdy <span className="font-normal text-slate-400">· {periodLabel(period)}{loading ? ' · wczytuję…' : ''}</span></h3>
        <PeriodPicker value={period} onChange={onPeriod} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[{ userId: 'all' as const, fullName: 'Cały zespół' }, ...withData].map((p) => (
          <button key={p.userId} onClick={() => setWho(p.userId)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${who === p.userId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {p.fullName}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <HourChart hourSec={hourSec} />
        <WeekdayChart weekdayKm={weekdayKm} weekdayDays={weekdayDays} />
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-800 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

/** Wspólna oś Y z poziomymi liniami siatki. */
function Grid({ ticks, top, fmt }: { ticks: number[]; top: number; fmt: (v: number) => string }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-slate-100" style={{ bottom: `${(t / top) * 100}%` }}>
          <span className="absolute -top-2 -left-10 w-8 text-right text-[10px] text-slate-400 tabular-nums">{fmt(t)}</span>
        </div>
      ))}
    </>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
      {children}
    </div>
  );
}

function HourChart({ hourSec }: { hourSec: number[] }) {
  const total = sum(hourSec);
  const outside = sum(hourSec.filter((_, h) => h < WORK_FROM || h >= WORK_TO));
  const peak = hourSec.indexOf(Math.max(...hourSec));
  const { top, ticks } = niceScale(Math.max(...hourSec) / 3600);

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock size={15} className="text-brand-600" /> Godziny jazdy w ciągu doby</h4>
      {total ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Łączny czas jazdy" value={hoursLabel(total)} />
            <Kpi label="Najwięcej jazdy" value={`${peak}:00–${peak + 1}:00`} />
            <Kpi label={`Poza ${WORK_FROM}:00–${WORK_TO}:00`} value={`${Math.round((outside / total) * 100)}%`} hint={hoursLabel(outside)} />
          </div>
          <div className="relative ml-10 h-40">
            {/* Pasmo godzin pracy – jazdy poza nim od razu widać. */}
            <div className="absolute inset-y-0 rounded bg-brand-50" style={{ left: `${(WORK_FROM / 24) * 100}%`, width: `${((WORK_TO - WORK_FROM) / 24) * 100}%` }} />
            <Grid ticks={ticks} top={top} fmt={(v) => `${fmtNumber(v)} h`} />
            <div className="absolute inset-0 flex items-end">
              {hourSec.map((sec, h) => (
                <div key={h} className="group relative flex h-full flex-1 items-end justify-center px-px hover:bg-slate-100/60">
                  <div className="w-full max-w-[18px] rounded-t" style={{ height: `${(sec / 3600 / top) * 100}%`, minHeight: sec ? 2 : 0, backgroundColor: BLUE, opacity: h < WORK_FROM || h >= WORK_TO ? 0.55 : 1 }} />
                  {h === peak && <span className="absolute whitespace-nowrap text-[10px] font-semibold text-slate-700" style={{ bottom: `calc(${(sec / 3600 / top) * 100}% + 2px)` }}>{hoursLabel(sec)}</span>}
                  <Tip><b>{h}:00–{h + 1}:00</b> · {hoursLabel(sec)} jazdy ({total ? Math.round((sec / total) * 100) : 0}%)</Tip>
                </div>
              ))}
            </div>
          </div>
          <div className="ml-10 flex text-[10px] text-slate-400">
            {hourSec.map((_, h) => <span key={h} className="flex-1 text-center">{h % 3 === 0 ? h : ''}</span>)}
          </div>
          <div className="ml-10 mt-1.5 flex flex-wrap gap-x-4 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-brand-50 ring-1 ring-brand-100" />godziny pracy {WORK_FROM}:00–{WORK_TO}:00</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: BLUE }} />jazda w godzinach pracy</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: BLUE, opacity: 0.55 }} />poza nimi</span>
          </div>
        </>
      ) : <p className="py-10 text-center text-sm text-slate-400">Brak jazd w wybranym okresie.</p>}
    </section>
  );
}

function WeekdayChart({ weekdayKm, weekdayDays }: { weekdayKm: number[]; weekdayDays: number[] }) {
  const total = sum(weekdayKm);
  const work = sum(weekdayKm.slice(0, 5));
  const weekend = sum(weekdayKm.slice(5));
  const workDays = sum(weekdayDays.slice(0, 5));
  const weekendDays = sum(weekdayDays.slice(5));
  const { top, ticks } = niceScale(Math.max(...weekdayKm));
  const km = (v: number) => `${fmtNumber(Math.round(v))} km`;

  return (
    <section className="rounded-xl border border-slate-200 p-4">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays size={15} className="text-brand-600" /> Dystans w dniach tygodnia</h4>
      {total ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Kpi label="Łączny dystans" value={km(total)} />
            <Kpi label="Dni robocze" value={km(work)} hint={workDays ? `śr. ${km(work / workDays)}/dzień` : undefined} />
            <Kpi label="Weekendy" value={`${Math.round((weekend / total) * 100)}%`} hint={`${km(weekend)}${weekendDays ? ` · śr. ${km(weekend / weekendDays)}/dzień` : ''}`} />
          </div>
          <div className="relative ml-10 h-40">
            <Grid ticks={ticks} top={top} fmt={(v) => (v >= 1000 ? `${fmtNumber(v / 1000)} tys.` : fmtNumber(v))} />
            <div className="absolute inset-0 flex items-end">
              {weekdayKm.map((v, d) => (
                <div key={d} className="group relative flex h-full flex-1 items-end justify-center hover:bg-slate-100/60">
                  <div className="w-full max-w-[24px] rounded-t" style={{ height: `${(v / top) * 100}%`, minHeight: v ? 2 : 0, backgroundColor: d < 5 ? BLUE : ORANGE }} />
                  <span className="absolute text-[10px] font-medium text-slate-700 tabular-nums" style={{ bottom: `calc(${(v / top) * 100}% + 2px)` }}>{fmtNumber(Math.round(v))}</span>
                  <Tip>
                    <b>{DAY_FULL[d]}</b> · {km(v)}
                    {weekdayDays[d] ? <> · {weekdayDays[d]} {weekdayDays[d] === 1 ? 'dzień' : 'dni'} w okresie, śr. {km(v / weekdayDays[d])}</> : null}
                  </Tip>
                </div>
              ))}
            </div>
          </div>
          <div className="ml-10 flex text-[11px] text-slate-500">
            {DAY_NAMES.map((n) => <span key={n} className="flex-1 text-center">{n}</span>)}
          </div>
          <div className="ml-10 mt-1 flex text-[10px] text-slate-400">
            <span className="flex flex-[5] items-center gap-1.5 border-t border-slate-200 pt-0.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: BLUE }} />dni robocze</span>
            <span className="ml-1 flex flex-[2] items-center gap-1.5 border-t border-slate-200 pt-0.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: ORANGE }} />weekend</span>
          </div>
        </>
      ) : <p className="py-10 text-center text-sm text-slate-400">Brak jazd w wybranym okresie.</p>}
    </section>
  );
}
