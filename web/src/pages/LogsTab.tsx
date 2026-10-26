import { Fragment, useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useUsers } from '../lib/queries';
import { exportXlsx } from '../lib/export';
import { Button, ErrorText, Field } from '../components/ui';
import { ClientPanel } from '../components/ClientPanel';

interface LogRow {
  id: number; at: string; userId: number | null; userName: string | null; ip: string | null;
  category: string; action: string; clientId: number | null; clientName: string | null; summary: string;
  details: { changes?: { field: string; from: unknown; to: unknown }[]; request?: unknown; result?: unknown; [k: string]: unknown } | null;
  status: number | null;
}
interface Page { rows: LogRow[]; hasMore: boolean; categories: Record<string, string> }

const TONES: Record<string, string> = {
  auth: 'bg-slate-100 text-slate-600', client: 'bg-blue-50 text-blue-700', history: 'bg-emerald-50 text-emerald-700',
  task: 'bg-sky-50 text-sky-700', access: 'bg-amber-50 text-amber-800', users: 'bg-violet-50 text-violet-700',
  settings: 'bg-slate-100 text-slate-700', integration: 'bg-cyan-50 text-cyan-700', import: 'bg-indigo-50 text-indigo-700',
  export: 'bg-orange-50 text-orange-700', view: 'bg-slate-50 text-slate-500',
};

const today = () => format(new Date(), 'yyyy-MM-dd');

/** Administracja → Logi: pełny dziennik zdarzeń (kto, kiedy, co zmienił) z filtrami i eksportem. */
export function LogsTab() {
  const { data: users = [] } = useUsers();
  const [filters, setFilters] = useState({ from: format(addDays(new Date(), -6), 'yyyy-MM-dd'), to: today(), user: '', category: '', q: '' });
  const [debounced, setDebounced] = useState(filters);
  useEffect(() => { const t = setTimeout(() => setDebounced(filters), 350); return () => clearTimeout(t); }, [filters]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [client, setClient] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const qs = (extra: Record<string, string>) => new URLSearchParams(Object.entries({ ...debounced, ...extra }).filter(([, v]) => v)).toString();
  const query = useInfiniteQuery({
    queryKey: ['audit', debounced],
    queryFn: ({ pageParam }) => api.get<Page>(`/api/admin/audit?${qs({ before: pageParam ? String(pageParam) : '' })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.rows[last.rows.length - 1].id : undefined),
  });
  const rows = query.data?.pages.flatMap((p) => p.rows) ?? [];
  const categories = query.data?.pages[0]?.categories ?? {};
  const set = (k: keyof typeof filters, v: string) => setFilters({ ...filters, [k]: v });

  async function exportAll() {
    setExporting(true);
    try {
      const data = await api.get<Page>(`/api/admin/audit?${qs({ limit: '5000' })}`);
      await exportXlsx(`logi-${debounced.from}-${debounced.to}.xlsx`, 'Logi', [
        { label: 'Data i godzina', value: (r: LogRow) => new Date(r.at), width: 18 },
        { label: 'Użytkownik', value: (r) => r.userName, width: 22 },
        { label: 'Kategoria', value: (r) => categories[r.category] ?? r.category, width: 18 },
        { label: 'Akcja', value: (r) => r.action, width: 30 },
        { label: 'Klient', value: (r) => r.clientName, width: 30 },
        { label: 'Szczegóły', value: (r) => [r.summary, ...(r.details?.changes ?? []).map((c) => `${c.field}: ${String(c.from)} → ${String(c.to)}`)].filter(Boolean).join('\n'), width: 70 },
        { label: 'Adres IP', value: (r) => r.ip, width: 16 },
      ], data.rows);
    } finally { setExporting(false); }
  }

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <Field label="Od dnia"><input type="date" className="input w-40" value={filters.from} max={filters.to} onChange={(e) => set('from', e.target.value)} /></Field>
        <Field label="Do dnia"><input type="date" className="input w-40" value={filters.to} min={filters.from} max={today()} onChange={(e) => set('to', e.target.value)} /></Field>
        <Field label="Użytkownik">
          <select className="input w-48" value={filters.user} onChange={(e) => set('user', e.target.value)}>
            <option value="">— wszyscy —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.active ? '' : ' (zablokowany)'}</option>)}
            <option value="none">— nieznany (np. nieudane logowanie) —</option>
          </select>
        </Field>
        <Field label="Kategoria">
          <select className="input w-48" value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">— wszystkie —</option>
            {Object.entries(categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Szukaj (klient, treść, IP)" className="min-w-48 flex-1">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" />
            <input className="input pl-8" value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder="np. nazwa klienta" />
          </div>
        </Field>
        <Button variant="ghost" onClick={exportAll} disabled={exporting || !rows.length}><Download size={15} /> {exporting ? 'Eksportuję…' : 'Excel'}</Button>
      </div>

      <ErrorText error={query.error} />
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-6" />
                <th className="px-3 py-2.5 text-left">Kiedy</th>
                <th className="px-3 text-left">Kto</th>
                <th className="px-3 text-left">Co</th>
                <th className="px-3 text-left">Klient</th>
                <th className="px-3 text-left">Szczegóły</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const expandable = Boolean(r.details || r.ip);
                const isOpen = open.has(r.id);
                const failed = r.status === 401 || r.status === 403;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t border-slate-100 align-top ${expandable ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => expandable && toggle(r.id)}>
                      <td className="pt-2.5 pl-2 text-slate-400">{expandable && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600 tabular-nums">{fmtDateTime(r.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{r.userName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${TONES[r.category] ?? 'bg-slate-100'}`}>{categories[r.category] ?? r.category}</span>
                        <span className={failed ? 'font-medium text-red-600' : ''}>{r.action}</span>
                      </td>
                      <td className="px-3 py-2">
                        {r.clientName && (r.clientId
                          ? <button className="text-left font-medium text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); setClient(r.clientId); }}>{r.clientName}</button>
                          : r.clientName)}
                      </td>
                      <td className="max-w-md px-3 py-2 text-slate-600"><div className="line-clamp-2 break-words">{r.summary}</div></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/70">
                        <td />
                        <td colSpan={5} className="px-3 pt-1 pb-3 text-xs text-slate-600">
                          {r.summary && <p className="mb-2 whitespace-pre-wrap break-words text-sm text-slate-700">{r.summary}</p>}
                          {r.details?.changes?.length ? (
                            <table className="mb-2 min-w-[50%]">
                              <thead><tr className="text-slate-400"><th className="pr-4 text-left font-medium">Pole</th><th className="pr-4 text-left font-medium">Było</th><th className="text-left font-medium">Jest</th></tr></thead>
                              <tbody>
                                {r.details.changes.map((c, i) => (
                                  <tr key={i}>
                                    <td className="py-0.5 pr-4 font-medium text-slate-700">{c.field}</td>
                                    <td className="py-0.5 pr-4 text-red-700 line-through decoration-red-300">{String(c.from ?? '—')}</td>
                                    <td className="py-0.5 text-emerald-700">{String(c.to ?? '—')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : null}
                          {(() => {
                            // Surowe dane żądania pokazujemy tylko, gdy nie ma czytelnej listy zmian.
                            const rest = Object.entries(r.details ?? {}).filter(([k]) => k !== 'changes' && !(k === 'request' && r.details?.changes?.length));
                            return rest.length ? (
                              <pre className="mb-2 max-h-48 overflow-auto rounded-lg bg-white p-2 font-mono text-[11px] ring-1 ring-slate-200">
                                {JSON.stringify(Object.fromEntries(rest), null, 2)}
                              </pre>
                            ) : null;
                          })()}
                          <span className="text-slate-400">Adres IP: {r.ip ?? '—'} · nr zdarzenia {r.id}</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {!query.isLoading && !rows.length && <p className="px-4 py-10 text-center text-sm text-slate-400">Brak zdarzeń dla wybranych filtrów.</p>}
        </div>
        {query.hasNextPage && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button variant="ghost" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>{query.isFetchingNextPage ? 'Wczytuję…' : 'Pokaż starsze'}</Button>
          </div>
        )}
      </section>

      {client && (
        <>
          <div className="fixed inset-0 z-30 bg-slate-900/20" onClick={() => setClient(null)} />
          <aside className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:w-[540px]">
            <ClientPanel key={client} clientId={client} onClose={() => setClient(null)} />
          </aside>
        </>
      )}
    </div>
  );
}
