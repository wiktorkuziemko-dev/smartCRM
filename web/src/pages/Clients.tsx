import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, Eye, FilterX, Plus, Search } from 'lucide-react';
import type { ClientRow, CustomField, Status, Tag } from '../lib/api';
import { fmtDate, fmtDue, fmtNip, fmtNumber, isOverdue } from '../lib/format';
import { exportXlsx } from '../lib/export';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Me } from '../lib/api';
import { canExport, clientColumnsOf, useClients, useFields, useMe, useNavLabels, useStatuses, useTags, useVoivodeships } from '../lib/queries';
import { ClientPanel } from '../components/ClientPanel';
import { ClientForm } from '../components/ClientForm';
import { formatCustomValue } from '../components/CustomFieldInput';
import { Button, Empty, StatusBadge, TagChip } from '../components/ui';

type Value = string | number | boolean | null | undefined;
interface Column {
  id: string;
  label: string;
  value: (r: ClientRow) => Value;          // do sortowania i eksportu
  text?: (r: ClientRow) => string;        // tekst do wyświetlenia/filtrowania
  render?: (r: ClientRow) => ReactNode;
  filter: 'text' | 'number' | { options: string[] };
  match?: (r: ClientRow, f: string) => boolean; // własna logika filtra
  width: number;
}


/** Filtr liczbowy: "100", ">100", "<=50", "10-20". */
function matchNumber(value: Value, query: string) {
  if (value == null || value === '') return false;
  const n = Number(value);
  const q = query.replace(/\s/g, '').replace(',', '.');
  const range = q.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (range) return n >= Number(range[1]) && n <= Number(range[2]);
  const cmp = q.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+)?)$/);
  if (!cmp) return String(value).includes(q);
  const v = Number(cmp[2]);
  switch (cmp[1]) {
    case '>': return n > v;
    case '<': return n < v;
    case '>=': return n >= v;
    case '<=': return n <= v;
    default: return n === v;
  }
}

export function buildColumns(statuses: Status[], tags: Tag[], fields: CustomField[], voivodeships: string[], owners: string[]): Column[] {
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const cols: Column[] = [
    { id: 'name', label: 'Nazwa', value: (r) => r.name, filter: 'text', width: 220,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
          {r.name}
          {!r.canEdit && <span title="Tylko podgląd"><Eye size={13} className="text-amber-500" /></span>}
        </span>
      ) },
    { id: 'nip', label: 'NIP', value: (r) => r.nip, text: (r) => fmtNip(r.nip), filter: 'text', width: 120 },
    { id: 'voivodeship', label: 'Województwo', value: (r) => r.voivodeship, filter: { options: voivodeships }, width: 140 },
    { id: 'contact', label: 'Osoba kontaktowa', value: (r) => r.contactName, filter: 'text', width: 170,
      render: (r) => r.contactName && <div><div>{r.contactName}</div>{r.contactPosition && <div className="text-xs text-slate-400">{r.contactPosition}</div>}</div> },
    { id: 'phone', label: 'Telefon', value: (r) => r.contactPhone || r.phone, filter: 'text', width: 130 },
    { id: 'email', label: 'E-mail', value: (r) => r.contactEmail || r.email, filter: 'text', width: 190 },
    { id: 'potential', label: 'Potencjał', value: (r) => r.potential, text: (r) => fmtNumber(r.potential), filter: 'number', width: 100 },
    { id: 'currentSolution', label: 'Aktualne rozwiązanie', value: (r) => r.currentSolution, filter: 'text', width: 180 },
    { id: 'status', label: 'Status', filter: { options: statuses.map((s) => s.name) }, width: 150,
      value: (r) => statusById.get(r.statusId ?? -1)?.position ?? -1,
      text: (r) => statusById.get(r.statusId ?? -1)?.name ?? '',
      render: (r) => { const s = statusById.get(r.statusId ?? -1); return s && <StatusBadge name={s.name} color={s.color} />; } },
  ];
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const tagsOf = (r: ClientRow) => r.tagIds.map((id) => tagById.get(id)).filter((t): t is Tag => Boolean(t));
  cols.splice(1, 0, { id: 'tags', label: 'Tagi', filter: { options: tags.map((t) => t.name) }, width: 150,
    value: (r) => tagsOf(r).map((t) => t.name).join(', '),
    match: (r, f) => tagsOf(r).some((t) => t.name === f),
    render: (r) => <div className="flex gap-1">{tagsOf(r).map((t) => <TagChip key={t.id} name={t.name} color={t.color} />)}</div> });
  cols.push({ id: 'owner', label: 'Opiekun', value: (r) => r.ownerName, filter: { options: owners }, width: 150 });
  cols.push({ id: 'tasks', label: 'Najbliższe zadanie', value: (r) => r.nextTaskDue, filter: 'text', width: 150,
    text: (r) => (r.nextTaskDue ? fmtDue(r.nextTaskDue) : ''),
    render: (r) => r.nextTaskDue && <span className={isOverdue(r.nextTaskDue) ? 'font-medium text-red-600' : ''}>{fmtDue(r.nextTaskDue)}{r.openTasks > 1 && <span className="text-slate-400"> (+{r.openTasks - 1})</span>}</span> });
  for (const f of fields.filter((x) => x.active && x.showInList)) {
    cols.push({
      id: `custom.${f.key}`, label: f.label, width: 140,
      value: (r) => r.custom[f.key] as Value,
      text: (r) => formatCustomValue(f, r.custom[f.key]),
      filter: f.type === 'number' ? 'number' : f.type === 'select' ? { options: f.options } : f.type === 'checkbox' ? { options: ['Tak', 'Nie'] } : 'text',
    });
  }
  cols.push({ id: 'updatedAt', label: 'Ostatnia zmiana', value: (r) => r.updatedAt, text: (r) => fmtDate(r.updatedAt), filter: 'text', width: 130 });
  return cols;
}

export function ClientsPage() {
  const labels = useNavLabels();
  const { id } = useParams();
  const selectedId = id ? Number(id) : null;
  const navigate = useNavigate();
  const { data: clients = [], isLoading } = useClients();
  const { data: statuses = [] } = useStatuses();
  const { data: fields = [] } = useFields();
  const { data: tags = [] } = useTags();
  const { data: voivodeships = [] } = useVoivodeships();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ id: string; desc: boolean }>({ id: 'updatedAt', desc: true });
  const [creating, setCreating] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const { data: me } = useMe();
  const qc = useQueryClient();
  // Widoczne kolumny: na start z Ustawień użytkownika; zmiany w menu „Kolumny” obowiązują do odświeżenia strony.
  const [visible, setVisible] = useState<string[]>(() => clientColumnsOf(me));
  const [savedMsg, setSavedMsg] = useState('');

  async function saveDefaultColumns() {
    const settings = await api.put<Me['settings']>('/api/me/settings', { clientColumns: visible });
    qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, settings } : old));
    setSavedMsg('Zapisano jako domyślne');
    setTimeout(() => setSavedMsg(''), 2500);
  }

  const allColumns = useMemo(
    // Filtr „Opiekun” pokazuje tylko osoby, które są opiekunami widocznych klientów.
    () => buildColumns(statuses, tags, fields, voivodeships,
      [...new Set(clients.map((c) => c.ownerName).filter((n): n is string => Boolean(n)))].sort((a, b) => a.localeCompare(b, 'pl'))),
    [statuses, tags, fields, voivodeships, clients],
  );
  const columns = allColumns.filter((c) => c.id === 'name' || visible.includes(c.id));
  const textOf = (c: Column, r: ClientRow) => (c.text ? c.text(r) : String(c.value(r) ?? ''));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = clients.filter((r) => {
      if (q && !allColumns.some((c) => textOf(c, r).toLowerCase().includes(q))) return false;
      return Object.entries(filters).every(([colId, f]) => {
        if (!f) return true;
        const col = allColumns.find((c) => c.id === colId);
        if (!col) return true;
        if (col.match) return col.match(r, f);
        if (col.filter === 'number') return matchNumber(col.value(r), f);
        if (typeof col.filter === 'object') return textOf(col, r) === f;
        return textOf(col, r).toLowerCase().includes(f.toLowerCase());
      });
    });
    const col = allColumns.find((c) => c.id === sort.id);
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const va = col.value(a), vb = col.value(b);
      if (va == null || va === '') return 1;           // puste zawsze na końcu
      if (vb == null || vb === '') return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pl', { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, search, filters, sort, allColumns]);

  const toggleSort = (colId: string) =>
    setSort((s) => (s.id === colId ? { id: colId, desc: !s.desc } : { id: colId, desc: false }));
  const activeFilters = Object.values(filters).filter(Boolean).length + (search ? 1 : 0);

  function exportList() {
    exportXlsx(`klienci-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Klienci',
      columns.map((c) => ({
        label: c.label,
        width: Math.round(c.width / 7),
        value: (r: ClientRow) => {
          if (c.id === 'updatedAt') return new Date(r.updatedAt);
          if (c.id === 'tasks') return r.nextTaskDue ? new Date(r.nextTaskDue) : null;
          const v = c.value(r);
          return typeof v === 'number' && c.id !== 'status' ? v : textOf(c, r);
        },
      })), rows);
  }

  return (
    <div className="flex h-full">
      <div className={`flex min-w-0 flex-1 flex-col ${selectedId ? 'hidden xl:flex' : ''}`}>
        <div className="px-4 pb-3 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mr-auto text-2xl font-semibold text-slate-800">{labels.clients} <span className="text-base font-normal text-slate-400">{rows.length}{rows.length !== clients.length && ` z ${clients.length}`}</span></h1>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input w-64 pl-9" placeholder="Szukaj klienta…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {activeFilters > 0 && <Button variant="ghost" onClick={() => { setFilters({}); setSearch(''); }}><FilterX size={15} /> Wyczyść filtry</Button>}
            <div className="relative">
              <Button variant="secondary" onClick={() => setShowColumns((v) => !v)}><Columns3 size={15} /> Kolumny</Button>
              {showColumns && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColumns(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="max-h-72 overflow-y-auto p-2">
                      {allColumns.filter((c) => c.id !== 'name').map((c) => (
                        <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                          <input type="checkbox" className="accent-brand-600" checked={visible.includes(c.id)}
                            onChange={(e) => setVisible((v) => (e.target.checked ? [...v, c.id] : v.filter((x) => x !== c.id)))} />
                          {c.label}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1 border-t border-slate-100 p-2">
                      <Button variant="secondary" className="w-full py-1.5 text-xs" onClick={saveDefaultColumns}>
                        {savedMsg || 'Zapisz jako domyślne'}
                      </Button>
                      <button onClick={() => setVisible(clientColumnsOf(me))} className="w-full rounded-md py-1 text-xs text-slate-500 hover:bg-slate-50">
                        Przywróć moje domyślne
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {canExport(me) && <Button variant="secondary" onClick={exportList} disabled={!rows.length}><Download size={15} /> Eksport XLS</Button>}
            <Button onClick={() => setCreating(true)}><Plus size={16} /> Nowy klient</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-6 sm:px-6">
          <div className="w-max min-w-full rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-[1]">
                <tr>
                  {columns.map((c) => (
                    <th key={c.id} style={{ minWidth: c.width }} className="border-b border-slate-200 bg-slate-50 px-3 pt-2.5 pb-1 text-left first:rounded-tl-xl last:rounded-tr-xl">
                      <button onClick={() => toggleSort(c.id)} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800">
                        {c.label}
                        {sort.id === c.id ? (sort.desc ? <ArrowDown size={13} className="text-brand-600" /> : <ArrowUp size={13} className="text-brand-600" />) : <ChevronsUpDown size={12} className="text-slate-300" />}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr>
                  {columns.map((c) => (
                    <th key={c.id} className="border-b border-slate-200 bg-slate-50 px-2 pb-2 font-normal">
                      {typeof c.filter === 'object' ? (
                        <select className="input w-0 min-w-full px-2 py-1 text-xs" value={filters[c.id] ?? ''} onChange={(e) => setFilters({ ...filters, [c.id]: e.target.value })}>
                          <option value="">Wszystkie</option>
                          {c.filter.options.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input size={1} className="input px-2 py-1 text-xs" placeholder={c.filter === 'number' ? 'np. >100' : 'Filtruj…'}
                          value={filters[c.id] ?? ''} onChange={(e) => setFilters({ ...filters, [c.id]: e.target.value })} />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/clients/${r.id}`)}
                    className={`cursor-pointer transition ${r.id === selectedId ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                    {columns.map((c) => (
                      <td key={c.id} className="max-w-[280px] truncate border-b border-slate-100 px-3 py-2.5 text-slate-600">
                        {c.render ? c.render(r) : textOf(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!isLoading && rows.length === 0 && <Empty>{clients.length ? 'Brak klientów spełniających kryteria.' : 'Nie masz jeszcze klientów – dodaj pierwszego.'}</Empty>}
            {isLoading && <Empty>Ładowanie…</Empty>}
          </div>
        </div>
      </div>

      {selectedId && (
        <aside className="w-full shrink-0 overflow-y-auto border-l border-slate-200 bg-white shadow-xl xl:w-[540px]">
          <ClientPanel key={selectedId} clientId={selectedId} onClose={() => navigate('/clients')} />
        </aside>
      )}

      {creating && <ClientForm onClose={() => setCreating(false)} onSaved={(newId) => { setCreating(false); navigate(`/clients/${newId}`); }} />}
    </div>
  );
}
