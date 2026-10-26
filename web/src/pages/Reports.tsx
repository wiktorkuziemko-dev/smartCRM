import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Download, FileBarChart, Users, Clock, ShieldAlert, Building2 } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, fmtNumber } from '../lib/format';
import { useNavLabels, useStatuses, useTags, useUsers, useVoivodeships } from '../lib/queries';
import { exportXlsx } from '../lib/export';
import { Button, ErrorText, Field, StatusBadge } from '../components/ui';
import { ClientPanel } from '../components/ClientPanel';

type ParamType = 'days' | 'number' | 'owner' | 'status' | 'tag' | 'voivodeship' | 'user' | 'date';
interface Param { key: string; label: string; type: ParamType; default?: string | number; optional?: boolean }
interface ReportDef { key: string; group: string; title: string; description: string; params: Param[] }
type ColType = 'text' | 'client' | 'number' | 'days' | 'date' | 'datetime' | 'status';
interface Column { key: string; label: string; type: ColType }
type Row = Record<string, unknown>;
interface Result { columns: Column[]; rows: Row[] }

const GROUP_ICONS: Record<string, typeof Users> = { Handlowcy: Users, Klienci: Building2, 'Aktualność danych': Clock, 'Jakość danych': ShieldAlert };

/** Domyślne wartości parametrów raportu (okres dat: ostatnie 30 dni). */
function defaults(r: ReportDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of r.params) {
    if (p.default != null) out[p.key] = String(p.default);
    if (p.type === 'date') out[p.key] = format(p.key === 'from' ? addDays(new Date(), -29) : new Date(), 'yyyy-MM-dd');
  }
  return out;
}

/** Raporty dla kierownika i admina: kontrola pracy handlowców i aktualności danych. */
export function ReportsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const { data: reports = [] } = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportDef[]>('/api/reports'), staleTime: Infinity });
  const current = reports.find((r) => r.key === search.get('r')) ?? reports[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [openClient, setOpenClient] = useState<number | null>(null);
  const labels = useNavLabels();

  useEffect(() => { if (current) setValues(defaults(current)); }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pola liczbowe wpisywane z klawiatury – zapytanie dopiero po chwili bez zmian.
  const [debounced, setDebounced] = useState(values);
  useEffect(() => { const t = setTimeout(() => setDebounced(values), 400); return () => clearTimeout(t); }, [values]);
  const qs = new URLSearchParams(Object.entries(debounced).filter(([, v]) => v !== '')).toString();
  const missing = current?.params.some((p) => !p.optional && p.type === 'user' && !debounced[p.key]);
  const result = useQuery({
    queryKey: ['report', current?.key, qs],
    queryFn: () => api.get<Result>(`/api/reports/${current!.key}?${qs}`),
    enabled: Boolean(current) && !missing && debounced === values && Object.keys(defaults(current!)).every((k) => k in debounced),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === current?.key ? prev : undefined),
  });

  const groups = useMemo(() => [...new Set(reports.map((r) => r.group))], [reports]);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-slate-200 bg-white/70 p-4 lg:w-72 lg:overflow-y-auto lg:border-r lg:border-b-0">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold"><FileBarChart size={20} className="text-brand-600" /> {labels.reports}</h1>
        {groups.map((g) => {
          const Icon = GROUP_ICONS[g] ?? FileBarChart;
          return (
            <div key={g} className="mb-4">
              <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Icon size={12} />{g}</div>
              {reports.filter((r) => r.group === g).map((r) => (
                <button key={r.key} onClick={() => setSearch({ r: r.key })}
                  className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${r.key === current?.key ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {r.title}
                </button>
              ))}
            </div>
          );
        })}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {current && (
          <>
            <h2 className="text-xl font-semibold">{current.title}</h2>
            <p className="mb-4 text-sm text-slate-500">{current.description}</p>
            {current.params.length > 0 && (
              <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                {current.params.map((p) => (
                  <ParamInput key={p.key} param={p} value={values[p.key] ?? ''} onChange={(v) => setValues({ ...values, [p.key]: v })} />
                ))}
                <Button variant="ghost" onClick={() => setValues(defaults(current))}>Wyczyść</Button>
              </div>
            )}
            {missing ? <p className="py-10 text-center text-sm text-slate-400">Wybierz osobę, aby wygenerować raport.</p> : (
              <>
                <ErrorText error={result.error} />
                {result.data && (
                  <ResultTable report={current} result={result.data} loading={result.isFetching}
                    onClient={(id) => setOpenClient(id)} />
                )}
              </>
            )}
          </>
        )}
      </main>

      {openClient && (
        <>
          <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={() => { setOpenClient(null); qc.invalidateQueries({ queryKey: ['report'] }); }} />
          <aside className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:w-[540px]">
            <ClientPanel key={openClient} clientId={openClient} onClose={() => { setOpenClient(null); qc.invalidateQueries({ queryKey: ['report'] }); }} />
          </aside>
        </>
      )}
    </div>
  );
}

function ParamInput({ param: p, value, onChange }: { param: Param; value: string; onChange: (v: string) => void }) {
  const { data: users = [] } = useUsers();
  const { data: statuses = [] } = useStatuses();
  const { data: tags = [] } = useTags();
  const { data: voivodeships = [] } = useVoivodeships();
  const all = p.optional ? <option value="">— wszyscy —</option> : <option value="">— wybierz —</option>;
  const people = users.filter((u) => u.active);

  let input;
  switch (p.type) {
    case 'days': case 'number':
      input = <input type="number" min={0} className="input w-36" value={value} onChange={(e) => onChange(e.target.value)} placeholder={p.optional ? 'dowolny' : ''} />;
      break;
    case 'date':
      input = <input type="date" className="input w-40" value={value} max={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'owner':
      input = (
        <select className="input w-52" value={value} onChange={(e) => onChange(e.target.value)}>
          {all}<option value="none">— bez opiekuna —</option>
          {people.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      );
      break;
    case 'user':
      input = (
        <select className="input w-52" value={value} onChange={(e) => onChange(e.target.value)}>
          {all}{people.filter((u) => p.key !== 'user' || p.optional || u.role === 'SALES').map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
      );
      break;
    case 'status':
      input = <select className="input w-48" value={value} onChange={(e) => onChange(e.target.value)}>{all}{statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
      break;
    case 'tag':
      input = <select className="input w-40" value={value} onChange={(e) => onChange(e.target.value)}>{all}{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>;
      break;
    case 'voivodeship':
      input = <select className="input w-48" value={value} onChange={(e) => onChange(e.target.value)}>{all}{voivodeships.map((v) => <option key={v} value={v}>{v}</option>)}</select>;
      break;
  }
  return <Field label={p.label}>{input}</Field>;
}

const isNum = (t: ColType) => t === 'number' || t === 'days';
/** Kolumny z dłuższym tekstem – zawijane; pozostałe w jednej linii. */
const WRAP = new Set(['missing', 'title', 'group']);

function cellText(c: Column, v: unknown): string {
  if (v == null || v === '') return '—';
  if (c.type === 'date') return fmtDate(v as string);
  if (c.type === 'datetime') return fmtDateTime(v as string);
  if (isNum(c.type)) return fmtNumber(Number(v));
  return String(v);
}

function ResultTable({ report, result, loading, onClient }: { report: ReportDef; result: Result; loading: boolean; onClient: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  useEffect(() => setSort(null), [report.key]);
  const { columns } = result;

  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const col = columns.find((c) => c.key === sort.key);
    const val = (r: Row) => {
      const v = r[sort.key];
      if (v == null || v === '') return null;
      if (col && (col.type === 'date' || col.type === 'datetime')) return new Date(v as string).getTime();
      return col && isNum(col.type) ? Number(v) : String(v).toLocaleLowerCase('pl');
    };
    return [...result.rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x == null) return 1; // puste zawsze na końcu
      if (y == null) return -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl');
      return sort.desc ? -cmp : cmp;
    });
  }, [result, sort, columns]);

  // Suma kolumn liczbowych (bez „dni”), gdy raport jest zestawieniem lub listą z potencjałem.
  const sums = columns.map((c) => (c.type === 'number' ? rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null));
  const showSums = rows.length > 1 && sums.some((s) => s != null);

  function exportFile() {
    exportXlsx(`raport-${report.key}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`, report.title.slice(0, 31), columns.map((c) => ({
      label: c.label,
      width: c.type === 'client' || c.key === 'missing' || c.key === 'title' ? 36 : undefined,
      value: (r: Row) => {
        const v = r[c.key];
        if (v == null || v === '') return null;
        if (c.type === 'date' || c.type === 'datetime') return new Date(v as string);
        return isNum(c.type) ? Number(v) : String(v);
      },
    })), rows);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-sm text-slate-600">Wyników: <b className="text-slate-900">{fmtNumber(rows.length)}</b></span>
        {loading && <span className="text-xs text-slate-400">odświeżam…</span>}
        <Button variant="ghost" className="ml-auto" onClick={exportFile} disabled={!rows.length}><Download size={15} /> Eksport do Excela</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`cursor-pointer select-none px-3 py-2.5 align-bottom hover:text-slate-800 ${isNum(c.type) ? 'text-right' : 'text-left'}`}
                  onClick={() => setSort(sort?.key === c.key ? (sort.desc ? null : { key: c.key, desc: true }) : { key: c.key, desc: false })}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const clientId = r.clientId as number | undefined;
              return (
                <tr key={i} className={`border-t border-slate-100 ${clientId ? 'cursor-pointer hover:bg-brand-50/50' : ''}`} onClick={() => clientId && onClient(clientId)}>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${isNum(c.type) ? 'text-right tabular-nums' : ''} ${c.type === 'client' ? 'font-medium text-brand-700' : ''} ${WRAP.has(c.key) ? 'min-w-56' : 'whitespace-nowrap'}`}>
                      {c.type === 'status' && r[c.key]
                        ? <StatusBadge name={r[c.key] as string} color={(r.statusColor as string) ?? '#94a3b8'} />
                        : <span className={r[c.key] == null || r[c.key] === '' || r[c.key] === 0 ? 'text-slate-300' : ''}>{cellText(c, r[c.key])}</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
            {showSums && (
              <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 ${isNum(c.type) ? 'text-right tabular-nums' : ''}`}>
                    {i === 0 ? 'Razem' : sums[i] != null ? fmtNumber(sums[i]) : ''}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
        {!rows.length && <p className="px-4 py-10 text-center text-sm text-slate-400">Brak wyników – wszystko w porządku 👍</p>}
      </div>
    </section>
  );
}
