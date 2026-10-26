import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckSquare, Eye, Mail, MessageSquare, Package, Phone, Plus, UserPlus, Users, LogIn, Share2, Briefcase } from 'lucide-react';
import { api, type ActivityType, type Task } from '../lib/api';
import { fmtAgo, fmtNumber } from '../lib/format';
import { useMe, useNavLabels, useStatuses, useTasks } from '../lib/queries';
import { groupTasks } from '../lib/tasks';
import { TaskForm } from './TaskForm';
import { TaskItem } from './TaskItem';
import { Button, Empty } from './ui';

interface PeriodStats { logins: number; meetings: number; calls: number; emails: number; comments: number; clients: number }
interface SalesDashboardData {
  owned: number; sharedEdit: number; sharedView: number; potential: number;
  funnel: { statusId: number | null; count: number; potential: number }[];
  activity: Record<'today' | 'yesterday' | 'week', PeriodStats | undefined>;
  daily: { day: string; actions: number; logins: number }[];
  recent: { id: number; type: ActivityType; content: string; createdAt: string; clientId: number; clientName: string; taskDueAt: string | null }[];
}

const METRICS: { key: keyof PeriodStats; label: string; icon: typeof Phone }[] = [
  { key: 'logins', label: 'Wejścia do aplikacji', icon: LogIn },
  { key: 'meetings', label: 'Spotkania', icon: Users },
  { key: 'calls', label: 'Telefony', icon: Phone },
  { key: 'emails', label: 'E-maile', icon: Mail },
  { key: 'comments', label: 'Komentarze', icon: MessageSquare },
  { key: 'clients', label: 'Nowi klienci', icon: UserPlus },
];
const TYPE_LABEL: Partial<Record<ActivityType, { label: string; icon: typeof Phone }>> = {
  comment: { label: 'Komentarz', icon: MessageSquare },
  call: { label: 'Telefon', icon: Phone },
  meeting: { label: 'Spotkanie', icon: Users },
  email: { label: 'E-mail', icon: Mail },
};

/** Pulpit handlowca: jego klienci, lejek, zadania na 7 dni i jego aktywność. */
export function SalesDashboard() {
  const { data: me } = useMe();
  const { data } = useQuery({ queryKey: ['dashboard', 'me'], queryFn: () => api.get<SalesDashboardData>('/api/dashboard/me') });
  const hour = new Date().getHours();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">{hour < 18 ? 'Dzień dobry' : 'Dobry wieczór'}, {me?.fullName.split(' ')[0]} 👋</h1>
      <p className="mb-6 text-sm text-slate-500">Twoi klienci, zadania i aktywność.</p>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Tile icon={Briefcase} tone="from-blue-600 to-sky-500" value={fmtNumber(data?.owned ?? 0)} label="Moi klienci" hint="Klienci, których jesteś opiekunem" />
        <Tile icon={Share2} tone="from-indigo-600 to-blue-500" value={fmtNumber((data?.sharedEdit ?? 0) + (data?.sharedView ?? 0))} label="Udostępnieni mi"
          hint={`${data?.sharedEdit ?? 0} do edycji · ${data?.sharedView ?? 0} do podglądu`} />
        <Tile icon={Package} tone="from-sky-600 to-cyan-500" value={fmtNumber(data?.potential ?? 0)} label="Łączny potencjał (szt.)" hint="Suma potencjału moich klientów" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        <TasksPanel />
        <Funnel funnel={data?.funnel ?? []} />
      </div>

      <MyActivity data={data} />
    </div>
  );
}

function Tile({ icon: Icon, tone, value, label, hint }: { icon: typeof Phone; tone: string; value: string; label: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${tone}`}><Icon size={20} /></div>
        <div>
          <div className="text-2xl font-semibold leading-tight">{value}</div>
          <div className="text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-400">{hint}</div>
        </div>
      </div>
    </div>
  );
}

/** Duże okno zadań: zaległe, dziś, najbliższe 7 dni. */
function TasksPanel() {
  const labels = useNavLabels();
  const { data: me } = useMe();
  const { data: tasks = [] } = useTasks({ assigneeId: me?.id, status: 'open' });
  const [form, setForm] = useState<{ task?: Task } | null>(null);
  const [showOverdue, setShowOverdue] = useState(false);
  const all = groupTasks(tasks);
  const overdue = all.find((g) => g.key === 'overdue')!;
  // Dziś i najbliższe 7 dni zawsze na wierzchu; zaległe zwinięte w pasek, żeby ich nie zasłaniały.
  const groups = all.filter((g) => g.key === 'today' || g.key === 'week');
  const later = all.find((g) => g.key === 'later')?.items.length ?? 0;

  return (
    <section className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-3">
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <h2 className="mr-auto flex items-center gap-2 font-semibold"><CheckSquare size={18} className="text-brand-600" /> {labels.tasks}</h2>
        <Link to="/tasks" className="text-sm text-brand-600 hover:underline">Wszystkie</Link>
        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setForm({})}><Plus size={14} /> Nowe</Button>
      </div>
      {overdue.items.length > 0 && (
        <div className="border-t border-red-100 bg-red-50/70">
          <button onClick={() => setShowOverdue((v) => !v)} className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
            <span>Zaległe: {overdue.items.length}</span>
            <span className="text-xs font-normal">{showOverdue ? 'ukryj' : 'pokaż'}</span>
          </button>
          {showOverdue && <div className="max-h-64 overflow-y-auto bg-white">
            {overdue.items.map((t) => <TaskItem key={t.id} task={t} onOpen={() => setForm({ task: t })} />)}
          </div>}
        </div>
      )}
      <div className="max-h-[520px] min-h-[320px] flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.key}>
            <div className={`sticky top-0 z-[1] border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-semibold ${g.tone}`}>{g.title} · {g.items.length}</div>
            {g.items.length ? g.items.map((t) => <TaskItem key={t.id} task={t} onOpen={() => setForm({ task: t })} />)
              : <p className="px-4 py-3 text-sm text-slate-400">{g.key === 'today' ? 'Nic na dziś.' : 'Brak zadań w najbliższym tygodniu.'}</p>}
          </div>
        ))}
      </div>
      {later > 0 && <Link to="/tasks" className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500 hover:text-brand-600">+ {later} zadań z dalszym terminem</Link>}
      {form && <TaskForm task={form.task} onClose={() => setForm(null)} />}
    </section>
  );
}

/** Lejek: własni klienci i udostępnieni do edycji (bez udostępnionych tylko do podglądu). */
function Funnel({ funnel }: { funnel: SalesDashboardData['funnel'] }) {
  const { data: statuses = [] } = useStatuses();
  const visible = statuses.filter((s) => s.active || funnel.some((f) => f.statusId === s.id && f.count));
  const max = Math.max(1, ...funnel.map((f) => f.count));
  const total = funnel.reduce((s, f) => s + f.count, 0);
  const noStatus = funnel.find((f) => f.statusId === null)?.count ?? 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
      <h2 className="font-semibold">Lejek sprzedaży</h2>
      <p className="mb-4 text-xs text-slate-400">Moi klienci i udostępnieni do edycji · {total} klientów</p>
      <div className="space-y-3">
        {visible.map((s) => {
          const row = funnel.find((f) => f.statusId === s.id);
          return (
            <Link key={s.id} to="/clients" className="block rounded-lg hover:bg-slate-50">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-600">{s.name}</span>
                <span className="text-slate-500"><b className="text-slate-800">{row?.count ?? 0}</b>{row?.potential ? ` · ${fmtNumber(row.potential)} szt.` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full transition-all" style={{ width: `${((row?.count ?? 0) / max) * 100}%`, backgroundColor: s.color }} />
              </div>
            </Link>
          );
        })}
        {noStatus > 0 && <p className="text-xs text-slate-400">Bez statusu: {noStatus}</p>}
      </div>
    </section>
  );
}

/** Moja aktywność: zestawienie okresów, 14 dni dzień po dniu i ostatnie działania. */
function MyActivity({ data }: { data?: SalesDashboardData }) {
  const periods = [
    { key: 'today' as const, label: 'Dziś' },
    { key: 'yesterday' as const, label: 'Wczoraj' },
    { key: 'week' as const, label: '7 dni' },
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><Activity size={18} className="text-brand-600" /> Moja aktywność</h2>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2 text-left font-medium" />
                {periods.map((p) => <th key={p.key} className="pb-2 text-right font-medium">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key} className="border-t border-slate-100">
                  <td className="py-2 text-slate-600"><span className="inline-flex items-center gap-2"><m.icon size={14} className="text-slate-400" />{m.label}</span></td>
                  {periods.map((p) => {
                    const v = data?.activity[p.key]?.[m.key] ?? 0;
                    return <td key={p.key} className={`py-2 text-right tabular-nums ${v ? 'font-medium text-slate-800' : 'text-slate-300'}`}>{v}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="lg:col-span-3">
          <DailyChart daily={data?.daily ?? []} />
          <h3 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ostatnie działania</h3>
          {data?.recent.length ? (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((r) => {
                const t = TYPE_LABEL[r.type];
                return (
                  <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                    {t && <t.icon size={14} className="shrink-0 text-brand-600" />}
                    <span className="shrink-0 text-slate-500">{t?.label}</span>
                    <Link to={`/clients/${r.clientId}`} className="shrink-0 font-medium text-brand-600 hover:underline">{r.clientName}</Link>
                    <span className="min-w-0 flex-1 truncate text-slate-500">{r.content}</span>
                    <span className="shrink-0 text-xs text-slate-400">{fmtAgo(r.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          ) : <Empty>Brak działań – dodaj telefon, spotkanie lub komentarz na karcie klienta.</Empty>}
        </div>
      </div>
    </section>
  );
}

/** Słupki: działania dziennie z 14 dni (jedna seria); wejścia tylko w dymku, bez drugiej osi. */
function DailyChart({ daily }: { daily: SalesDashboardData['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.actions));
  const total = daily.reduce((s, d) => s + d.actions, 0);
  const activeDays = daily.filter((d) => d.actions > 0).length;
  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Działania dziennie – 14 dni</h3>
        <span className="text-xs text-slate-400">{total} działań · aktywne dni: {activeDays}/14</span>
      </div>
      <div className="relative">
        <div className="flex h-32 items-end gap-[2px] border-b border-slate-200">
          {daily.map((d, i) => (
            <div key={d.day} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {d.actions
                ? <div className={`w-full rounded-t ${hover === i ? 'bg-brand-700' : 'bg-brand-500'}`} style={{ height: `${Math.max(4, (d.actions / max) * 100)}%` }} />
                : <div className={`h-[3px] w-full rounded-t ${hover === i ? 'bg-slate-400' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
        {hover !== null && daily[hover] && (
          <div className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow-lg"
            style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }}>
            <div className="font-medium">{dayLabel(daily[hover].day)}</div>
            <div>Działania: {daily[hover].actions}</div>
            <div className="text-slate-300">Wejścia: {daily[hover].logins}</div>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[11px] text-slate-400">
          <span>{daily[0] ? dayLabel(daily[0].day) : ''}</span>
          <span>dziś</span>
        </div>
      </div>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400"><Eye size={11} /> Działania: spotkania, telefony, e-maile, komentarze i nowi klienci.</p>
    </div>
  );
}
