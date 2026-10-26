import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Mail, MessageSquare, Phone, UserPlus, Users, LogIn } from 'lucide-react';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { Avatar } from './ui';
import { PeriodPicker, isValidPeriod, presetPeriod, type Period } from './PeriodPicker';

interface Row {
  userId: number; fullName: string; lastSeenAt: string | null;
  logins: number; meetings: number; calls: number; emails: number; comments: number; clients: number;
}

const METRICS: { key: keyof Row; label: string; icon: typeof Phone; title: string }[] = [
  { key: 'logins', label: 'Wejścia', icon: LogIn, title: 'Logowania i powroty do aplikacji po co najmniej 30 min przerwy' },
  { key: 'meetings', label: 'Spotkania', icon: Users, title: 'Dodane spotkania' },
  { key: 'calls', label: 'Telefony', icon: Phone, title: 'Dodane telefony' },
  { key: 'emails', label: 'E-maile', icon: Mail, title: 'Dodane e-maile' },
  { key: 'comments', label: 'Komentarze', icon: MessageSquare, title: 'Dodane komentarze' },
  { key: 'clients', label: 'Nowi klienci', icon: UserPlus, title: 'Klienci dodani przez handlowca' },
];

/** Działania (bez wejść) – do kolumny „Razem” i podświetlenia braku aktywności. */
const actions = (r: Row) => r.meetings + r.calls + r.emails + r.comments + r.clients;

/** Aktywność handlowców dla kierownika i admina: dziś / wczoraj / ostatnie 7 dni / dowolny okres. */
export function TeamActivity() {
  const [period, setPeriod] = useState<Period>(() => presetPeriod('today'));
  const custom = period.key === 'custom';
  const presets = useQuery({
    queryKey: ['dashboard', 'team'],
    queryFn: () => api.get<Record<'today' | 'yesterday' | 'week', Row[]>>('/api/dashboard/team'),
    refetchInterval: 60_000,
  });
  const range = useQuery({
    queryKey: ['dashboard', 'team', period.from, period.to],
    queryFn: () => api.get<{ custom: Row[] }>(`/api/dashboard/team?from=${period.from}&to=${period.to}`),
    enabled: custom && isValidPeriod(period),
    placeholderData: (prev) => prev,
  });
  const isLoading = custom ? range.isLoading : presets.isLoading;
  const rows = (custom ? range.data?.custom : presets.data?.[period.key as 'today']) ?? [];
  const totals = METRICS.map((m) => rows.reduce((s, r) => s + Number(r[m.key]), 0));

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
        <h2 className="mr-auto flex items-center gap-2 font-semibold"><Activity size={18} className="text-brand-600" /> Aktywność handlowców</h2>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">Handlowiec</th>
              {METRICS.map((m) => (
                <th key={m.key} className="px-3 text-center" title={m.title}>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap"><m.icon size={12} />{m.label}</span>
                </th>
              ))}
              <th className="px-3 text-center" title="Spotkania, telefony, e-maile, komentarze i nowi klienci">Razem</th>
              <th className="px-5 text-right">Ostatnio aktywny</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const idle = actions(r) === 0;
              return (
                <tr key={r.userId} className="border-t border-slate-100">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2"><Avatar name={r.fullName} size={26} /><span className="font-medium">{r.fullName}</span></div>
                  </td>
                  {METRICS.map((m) => {
                    const v = Number(r[m.key]);
                    return <td key={m.key} className={`px-3 text-center tabular-nums ${v ? 'font-medium text-slate-800' : 'text-slate-300'}`}>{v}</td>;
                  })}
                  <td className="px-3 text-center">
                    <span className={`inline-block min-w-8 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${idle ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>{actions(r)}</span>
                  </td>
                  <td className="px-5 text-right text-xs text-slate-500">{r.lastSeenAt ? fmtAgo(r.lastSeenAt) : 'nigdy'}</td>
                </tr>
              );
            })}
            {rows.length > 1 && (
              <tr className="border-t border-slate-200 bg-slate-50/60 font-semibold">
                <td className="px-5 py-2.5 text-slate-600">Razem</td>
                {totals.map((t, i) => <td key={METRICS[i].key} className="px-3 text-center tabular-nums">{t}</td>)}
                <td className="px-3 text-center tabular-nums">{totals.slice(1).reduce((a, b) => a + b, 0)}</td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-400">Brak aktywnych handlowców.</p>}
      </div>
      {range.error && custom ? <p className="px-5 py-3 text-sm text-red-600">{(range.error as Error).message}</p> : <div className="h-2" />}
    </section>
  );
}
