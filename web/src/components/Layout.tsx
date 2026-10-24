import { useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Home, LogOut, Menu, Settings, ShieldCheck, Users } from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABELS, useMe, useTasks } from '../lib/queries';
import { Avatar } from './ui';
import { Reminders } from './Reminders';

export function Layout() {
  const { data: me, isLoading, isError } = useMe();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: myTasks } = useTasks({ assigneeId: me?.id, status: 'open' });

  if (isLoading) return <div className="flex h-screen items-center justify-center text-slate-400">Ładowanie…</div>;
  if (isError || !me) return <Navigate to="/login" replace />;

  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const dueCount = (myTasks ?? []).filter((t) => new Date(t.dueAt) <= endOfToday).length;

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/login');
  };

  const nav = [
    { to: '/', label: 'Pulpit', icon: Home, end: true },
    { to: '/clients', label: 'Klienci', icon: Users },
    { to: '/tasks', label: 'Moje zadania', icon: CheckSquare, badge: dueCount },
    { to: '/settings', label: 'Ustawienia', icon: Settings },
    ...(me.role === 'ADMIN' ? [{ to: '/admin', label: 'Administracja', icon: ShieldCheck }] : []),
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {open && <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={`bg-brand-gradient fixed inset-y-0 left-0 z-40 flex w-60 flex-col text-white transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 font-bold backdrop-blur">S</div>
          <span className="text-lg font-semibold tracking-tight">SmartCRM</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {nav.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/20 shadow-inner' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}>
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {badge ? <span className="rounded-full bg-white px-1.5 text-xs font-semibold text-brand-700">{badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/15 p-3">
          <NavLink to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/10">
            <Avatar name={me.fullName} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me.fullName}</div>
              <div className="text-xs text-white/70">{ROLE_LABELS[me.role]}</div>
            </div>
          </NavLink>
          <button onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white">
            <LogOut size={16} /> Wyloguj
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded-md p-1 text-slate-600 hover:bg-slate-100"><Menu size={20} /></button>
          <span className="font-semibold text-brand-700">SmartCRM</span>
        </header>
        <main className="bg-soft-gradient min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Reminders tasks={myTasks ?? []} />
    </div>
  );
}
