import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Dashboard } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { seesAll, useMe } from '../lib/queries';
import { Empty } from '../components/ui';
import { TeamActivity } from '../components/TeamActivity';
import { SalesDashboard } from '../components/SalesDashboard';
import { FieldActivity } from '../components/FieldActivity';

/** Handlowiec ma własny pulpit; kierownik i admin – pulpit zespołu. */
export function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return seesAll(me) ? <ManagerDashboard /> : <SalesDashboard />;
}

function ManagerDashboard() {
  const { data: me } = useMe();
  const { data } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/api/dashboard') });
  const hour = new Date().getHours();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold">{hour < 18 ? 'Dzień dobry' : 'Dobry wieczór'}, {me?.fullName.split(' ')[0]} 👋</h1>
      <p className="mb-6 text-sm text-slate-500">Oto podsumowanie pracy zespołu.</p>

      <TeamActivity />
      <FieldActivity />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
  );
}
