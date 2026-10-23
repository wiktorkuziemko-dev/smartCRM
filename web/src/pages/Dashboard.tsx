import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CalendarCheck, Package, Users } from 'lucide-react';
import { api, type Dashboard, type Task } from '../lib/api';
import { fmtAgo, fmtNumber } from '../lib/format';
import { useMe, useStatuses, useTasks } from '../lib/queries';
import { TaskForm } from '../components/TaskForm';
import { TaskItem } from '../components/TaskItem';
import { Empty } from '../components/ui';
import { groupTasks } from '../lib/tasks';

export function DashboardPage() {
  const { data: me } = useMe();
  const { data: statuses = [] } = useStatuses();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard') });
  const { data: tasks = [] } = useTasks({ assigneeId: me?.id, status: 'open' });
  const [form, setForm] = useState<{ task?: Task } | null>(null);

  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const today = tasks.filter((t) => new Date(t.dueAt) <= endOfToday);
  const overdue = tasks.filter((t) => new Date(t.dueAt) < new Date()).length;
  const byStatus = data?.byStatus ?? [];
  const total = byStatus.reduce((s, x) => s + x.count, 0);
  const totalPotential = byStatus.reduce((s, x) => s + x.potential, 0);
  const max = Math.max(1, ...byStatus.map((x) => x.count));
  const hour = new Date().getHours();

  const stats = [
    { label: 'Klienci', value: fmtNumber(total), icon: Users, tone: 'from-blue-600 to-sky-500' },
    { label: 'Łączny potencjał', value: fmtNumber(totalPotential), icon: Package, tone: 'from-indigo-600 to-blue-500' },
    { label: 'Zadania na dziś', value: today.length, icon: CalendarCheck, tone: 'from-sky-600 to-cyan-500' },
    { label: 'Zaległe', value: overdue, icon: AlertCircle, tone: overdue ? 'from-rose-600 to-orange-500' : 'from-slate-400 to-slate-300' },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">{hour < 18 ? 'Dzień dobry' : 'Dobry wieczór'}, {me?.fullName.split(' ')[0]} 👋</h1>
      <p className="mb-6 text-sm text-slate-500">Oto podsumowanie Twojej sprzedaży.</p>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white ${tone}`}><Icon size={18} /></div>
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-semibold">Lejek sprzedaży</h2>
          <div className="space-y-3">
            {statuses.filter((s) => s.active).map((s) => {
              const row = byStatus.find((b) => b.statusId === s.id);
              return (
                <div key={s.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-slate-600">{s.name}</span>
                    <span className="text-slate-500"><b className="text-slate-800">{row?.count ?? 0}</b>{row?.potential ? ` · ${fmtNumber(row.potential)} szt.` : ''}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${((row?.count ?? 0) / max) * 100}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold">Moje zadania</h2>
            <Link to="/tasks" className="text-sm text-brand-600 hover:underline">Wszystkie zadania</Link>
          </div>
          {groupTasks(tasks).filter((g) => g.key !== 'later' && (g.key !== 'overdue' || g.items.length)).map((g) => (
            <div key={g.key}>
              <div className={`border-t border-slate-100 bg-slate-50/60 px-4 py-1.5 text-xs font-semibold ${g.tone}`}>{g.title} · {g.items.length}</div>
              {g.items.length ? g.items.map((t) => <TaskItem key={t.id} task={t} onOpen={() => setForm({ task: t })} />)
                : <p className="px-4 py-3 text-sm text-slate-400">{g.key === 'today' ? 'Brak zadań na dziś.' : 'Brak zadań w najbliższym tygodniu.'}</p>}
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 font-semibold">Ostatnia aktywność</h2>
          {data?.recent.length ? (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 py-2 text-sm">
                  <Link to={`/clients/${a.clientId}`} className="shrink-0 font-medium text-brand-600 hover:underline">{a.clientName}</Link>
                  <span className="min-w-0 flex-1 truncate text-slate-600">{a.authorName}: {a.content || 'dodano załącznik'}</span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtAgo(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>Brak aktywności.</Empty>}
        </section>
      </div>
      {form && <TaskForm task={form.task} onClose={() => setForm(null)} />}
    </div>
  );
}
