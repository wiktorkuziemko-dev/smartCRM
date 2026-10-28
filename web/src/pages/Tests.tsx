import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Download, FlaskConical, RefreshCw } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { api } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { canExport, seesAll, useMe, useNavLabels } from '../lib/queries';
import { exportXlsx } from '../lib/export';
import { Button, ErrorText } from '../components/ui';
import { ClientPanel } from '../components/ClientPanel';

type DayStatus = 'OK' | 'brak' | '';
interface Meter { number: string; communicator: string; installed: string | null; lastReading: string | null; address: string | null; days: DayStatus[]; ok: number; missing: number; sla: number }
interface Result { domain: string; devices: number; expected: number; delivered: number; sla: number | null; meters: Meter[] }
interface Row { id: number; name: string; domain: string | null; ownerName: string | null; error: string | null; result: Result | null }
interface Data { configured: boolean; tagMissing?: boolean; tag?: string; from?: string; to?: string; days?: string[]; rows?: Row[] }

const day = (d: Date) => format(d, 'yyyy-MM-dd');
// Zaokrąglenie do 0,1%; wynik poniżej 100% nigdy nie jest pokazywany jako „100%”.
const pct = (v: number | null) => (v == null ? '—' : `${(v < 1 ? Math.min(Math.round(v * 1000) / 10, 99.9) : 100).toLocaleString('pl-PL')}%`);
const short = (s: string | null) => (s ? format(parseISO(s), 'dd.MM.yyyy') : '—');

/** Kolor SLA: 100% zielony, od 95% bursztynowy, poniżej czerwony – zawsze z wartością (nie sam kolor). */
function SlaBadge({ value }: { value: number | null }) {
  const tone = value == null ? 'bg-slate-100 text-slate-500' : value >= 1 ? 'bg-emerald-50 text-emerald-700' : value >= 0.95 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700';
  return <span className={`inline-block min-w-16 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${tone}`}>{pct(value)}</span>;
}

const CELL: Record<DayStatus, string> = { OK: 'bg-emerald-500 text-white', brak: 'bg-red-500 text-white', '': 'bg-slate-100 text-slate-300' };

/** Testy: wodociągi (klienci z tagiem testowym) i skuteczność raportowania nakładek – domyślnie ostatnie 7 dni. */
export function TestsPage() {
  const qc = useQueryClient();
  const labels = useNavLabels();
  const { data: me } = useMe();
  const yesterday = addDays(new Date(), -1);
  const [range, setRange] = useState({ from: day(addDays(yesterday, -6)), to: day(yesterday), custom: false });
  const [fresh, setFresh] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [client, setClient] = useState<number | null>(null);

  // Przy każdym wejściu w zakładkę dane są pobierane na nowo (staleTime 0, bez pamięci między wejściami).
  const { data, error, isFetching } = useQuery({
    queryKey: ['tests', range.from, range.to, fresh],
    queryFn: () => api.get<Data>(`/api/tests?from=${range.from}&to=${range.to}${fresh ? '&fresh=1' : ''}`),
    staleTime: 0, gcTime: 0, refetchOnMount: 'always',
    enabled: range.from <= range.to,
  });

  const rows = useMemo(() => {
    // Kolejność: najpierw wodociągi z wynikiem (najsłabsze SLA na górze), potem bez wodomierzy, na końcu z błędem.
    const rank = (r: Row) => (r.error ? 2 : r.result?.sla == null ? 1 : 0);
    return [...(data?.rows ?? [])].sort((a, b) => rank(a) - rank(b) || (a.result?.sla ?? 0) - (b.result?.sla ?? 0) || a.name.localeCompare(b.name, 'pl'));
  }, [data]);
  const withResult = rows.filter((r) => r.result?.sla != null);
  const perfect = withResult.filter((r) => r.result!.sla! >= 1).length;
  const empty = rows.filter((r) => !r.error && r.result && r.result.sla == null).length;
  const failed = rows.filter((r) => r.error).length;
  const days = data?.days ?? [];

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function exportFile() {
    type Line = { pipe: Row; meter: Meter };
    const lines: Line[] = rows.flatMap((r) => (r.result?.meters ?? []).map((meter) => ({ pipe: r, meter })));
    await exportXlsx(`testy-${range.from}-${range.to}.xlsx`, 'Wodomierze', [
      { label: 'Wodociąg', value: (l: Line) => l.pipe.name, width: 28 },
      { label: 'Domena', value: (l) => l.pipe.result?.domain, width: 28 },
      { label: 'Nr wodomierza', value: (l) => l.meter.number, width: 16 },
      { label: 'Nr nakładki', value: (l) => l.meter.communicator, width: 14 },
      { label: 'Data instalacji nakładki', value: (l) => short(l.meter.installed), width: 14 },
      { label: 'Data ostatniego odczytu', value: (l) => short(l.meter.lastReading), width: 14 },
      ...days.map((d, i) => ({ label: d, value: (l: Line) => l.meter.days[i], width: 11 })),
      { label: 'SLA w okresie', value: (l) => Math.round(l.meter.sla * 1000) / 10, width: 10 },
    ], lines);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto flex items-center gap-2 text-2xl font-semibold"><FlaskConical size={22} className="text-brand-600" /> {labels.tests}</h1>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm">
          <button onClick={() => setRange({ from: day(addDays(yesterday, -6)), to: day(yesterday), custom: false })}
            className={`rounded-md px-3 py-1 font-medium ${!range.custom ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>Ostatnie 7 dni</button>
          <button onClick={() => setRange({ ...range, custom: true })}
            className={`rounded-md px-3 py-1 font-medium ${range.custom ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>Okres</button>
        </div>
        {range.custom && (
          <div className="inline-flex items-center gap-1.5 text-sm text-slate-500">
            <input type="date" className="input w-auto py-1 text-sm" value={range.from} max={range.to}
              min={day(addDays(parseISO(range.to), -30))} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
            <span>–</span>
            <input type="date" className="input w-auto py-1 text-sm" value={range.to} min={range.from} max={day(new Date())}
              onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          </div>
        )}
        <Button variant="ghost" onClick={() => setFresh((n) => n + 1)} disabled={isFetching} title="Pobierz dane z SMART na nowo">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Odśwież
        </Button>
        {canExport(me) && <Button variant="ghost" onClick={exportFile} disabled={!withResult.length}><Download size={15} /> Excel</Button>}
      </div>

      {data && !data.configured && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 text-sm text-slate-500">
          Integracja ze SMART nie jest skonfigurowana.{me?.role === 'ADMIN' ? <> Uzupełnij dane w <Link to="/admin?tab=smart" className="text-brand-600 hover:underline">Administracja → Integracja ze SMART</Link>.</> : ' Zgłoś to administratorowi.'}
        </p>
      )}
      {data?.tagMissing && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 text-sm text-slate-500">
          Nie wybrano tagu klientów testowych – {me?.role === 'ADMIN' ? 'wskaż go w Administracja → Integracja ze SMART.' : 'zgłoś to administratorowi.'}
        </p>
      )}
      <ErrorText error={error} />
      {isFetching && !data?.rows && <p className="py-10 text-center text-sm text-slate-400">Pobieram dane z platformy SMART…</p>}

      {data?.rows && (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {seesAll(me) ? 'Klienci' : 'Twoi klienci (pod opieką i udostępnieni)'} z tagiem <b>{data.tag}</b> · okres {short(data.from!)} – {short(data.to!)} ({days.length} dni)
            {isFetching && <span className="ml-2 text-slate-400">odświeżam…</span>}
          </p>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Wodociągi testowe', rows.length, 'text-slate-900'],
              ['SLA 100%', perfect, 'text-emerald-700'],
              ['SLA poniżej 100%', withResult.length - perfect, withResult.length - perfect ? 'text-red-700' : 'text-slate-900'],
              ['Bez wodomierzy / z błędem', empty + failed, empty + failed ? 'text-amber-700' : 'text-slate-900'],
            ].map(([label, value, tone]) => (
              <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
                <div className="text-sm text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-8" />
                    <th className="px-3 py-2.5 text-left">Wodociąg</th>
                    <th className="px-3 text-left">Domena</th>
                    <th className="px-3 text-right">Testowe wodomierze</th>
                    <th className="px-3 text-right">Oczekiwane raporty</th>
                    <th className="px-3 text-right">Dostarczone raporty</th>
                    <th className="px-3 text-center">SLA w okresie</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const res = r.result;
                    const expandable = Boolean(res?.meters.length);
                    const isOpen = open.has(r.id);
                    return (
                      <Fragment key={r.id}>
                        <tr className={`border-t border-slate-100 ${expandable ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => expandable && toggle(r.id)}>
                          <td className="pl-3 text-slate-400">{expandable && (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}</td>
                          <td className="px-3 py-2.5">
                            <button className="text-left font-medium text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); setClient(r.id); }}>{r.name}</button>
                            {r.ownerName && <div className="text-xs text-slate-400">{r.ownerName}</div>}
                          </td>
                          <td className="px-3 text-slate-500">{res?.domain ?? r.domain ?? '—'}</td>
                          {r.error ? (
                            <td colSpan={4} className="px-3 text-xs text-amber-800"><span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} className="shrink-0" />{r.error}</span></td>
                          ) : (
                            <>
                              <td className="px-3 text-right tabular-nums">{res!.devices}</td>
                              <td className="px-3 text-right tabular-nums">{fmtNumber(res!.expected)}</td>
                              <td className="px-3 text-right tabular-nums">{fmtNumber(res!.delivered)}</td>
                              <td className="px-3 text-center">{res!.sla == null ? <span className="text-xs text-slate-400">brak testowych wodomierzy</span> : <SlaBadge value={res!.sla} />}</td>
                            </>
                          )}
                        </tr>
                        {isOpen && res && (
                          <tr className="bg-slate-50/60">
                            <td />
                            <td colSpan={6} className="px-3 pt-1 pb-4"><MeterTable meters={res.meters} days={days} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && <p className="px-4 py-10 text-center text-sm text-slate-400">{seesAll(me) ? `Żaden klient nie ma tagu „${data.tag}”.` : `Nie masz klientów z tagiem „${data.tag}”.`}</p>}
            </div>
          </section>
          <p className="mt-2 text-xs text-slate-400">
            Raport z danego dnia liczy się jako dostarczony („OK”), gdy dotarł najwcześniej następnego dnia. Dni przed instalacją nakładki nie są liczone.
            Wyniki są pamiętane 5 minut – „Odśwież” pobiera je od razu na nowo.
          </p>
        </>
      )}

      {client && (
        <>
          <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={() => setClient(null)} />
          <aside className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:w-[540px]">
            <ClientPanel key={client} clientId={client} onClose={() => { setClient(null); qc.invalidateQueries({ queryKey: ['tests'] }); }} />
          </aside>
        </>
      )}
    </div>
  );
}

function MeterTable({ meters, days }: { meters: Meter[]; days: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-2 py-2 text-left font-medium">Nr wodomierza</th>
            <th className="px-2 text-left font-medium">Nr nakładki</th>
            <th className="px-2 text-left font-medium">Instalacja nakładki</th>
            <th className="px-2 text-left font-medium">Ostatni odczyt</th>
            {days.map((d) => <th key={d} className="px-0.5 text-center font-medium" title={d}>{format(parseISO(d), 'dd.MM')}</th>)}
            <th className="px-2 text-center font-medium">SLA</th>
          </tr>
        </thead>
        <tbody>
          {[...meters].sort((a, b) => a.sla - b.sla || a.number.localeCompare(b.number)).map((m) => (
            <tr key={m.communicator} className="border-t border-slate-100">
              <td className="whitespace-nowrap px-2 py-1.5 font-medium" title={m.address ?? ''}>{m.number || '—'}</td>
              <td className="px-2 tabular-nums">{m.communicator}</td>
              <td className="px-2 tabular-nums">{short(m.installed)}</td>
              <td className="px-2 tabular-nums">{short(m.lastReading)}</td>
              {m.days.map((s, i) => (
                <td key={i} className="px-0.5 py-1">
                  <div className={`mx-auto flex h-5 min-w-9 items-center justify-center rounded text-[10px] font-semibold ${CELL[s]}`} title={`${days[i]}: ${s || 'przed instalacją'}`}>
                    {s === 'OK' ? 'OK' : s === 'brak' ? 'brak' : '–'}
                  </div>
                </td>
              ))}
              <td className="px-2 text-center"><SlaBadge value={m.sla} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
