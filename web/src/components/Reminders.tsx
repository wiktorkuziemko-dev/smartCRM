import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, X } from 'lucide-react';
import type { Task } from '../lib/api';
import { fmtDue } from '../lib/format';

const LEAD_MS = 15 * 60_000; // przypomnienie 15 minut przed terminem
const STORAGE_KEY = 'smartcrm.reminded';

function loadReminded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')); } catch { return new Set(); }
}

/** Przypomnienia w aplikacji (+ powiadomienie systemowe, jeśli przeglądarka na to pozwala). */
export function Reminders({ tasks }: { tasks: Task[] }) {
  const [toasts, setToasts] = useState<Task[]>([]);
  const qc = useQueryClient();

  useEffect(() => {
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ['tasks'] }), 60_000);
    return () => clearInterval(id);
  }, [qc]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const check = () => {
      const reminded = loadReminded();
      const now = Date.now();
      // Klucz zawiera termin – po przesunięciu zadania przypomnienie pojawi się ponownie.
      const due = tasks.filter((t) => {
        const at = new Date(t.dueAt).getTime();
        return at - now <= LEAD_MS && now - at < 12 * 3600_000 && !reminded.has(`${t.id}:${t.dueAt}`);
      });
      if (!due.length) return;
      due.forEach((t) => {
        reminded.add(`${t.id}:${t.dueAt}`);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('SmartCRM – przypomnienie', { body: `${t.title}${t.clientName ? ` (${t.clientName})` : ''} – ${fmtDue(t.dueAt)}` });
        }
      });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...reminded].slice(-500))); } catch { /* brak dostępu */ }
      setToasts((prev) => [...prev, ...due]);
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [tasks]);

  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2">
      {toasts.slice(-4).map((t) => (
        <div key={t.id} className="flex gap-3 rounded-xl border border-brand-100 bg-white p-3 shadow-xl shadow-blue-900/10">
          <div className="bg-brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"><BellRing size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.title}</div>
            <div className="text-xs text-slate-500">{fmtDue(t.dueAt)}</div>
            {t.clientId && (
              <Link to={`/clients/${t.clientId}`} className="text-xs text-brand-600 hover:underline"
                onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
                {t.clientName}
              </Link>
            )}
          </div>
          <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} className="self-start text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
