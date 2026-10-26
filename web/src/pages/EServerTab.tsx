import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Satellite, Trash2 } from 'lucide-react';
import { api, type Role } from '../lib/api';
import { ROLE_LABELS } from '../lib/queries';
import { Avatar, Button, ErrorText, Field } from '../components/ui';

interface Config {
  configured: boolean; baseUrl: string; login: string;
  caPem: string; caCerts: { subject: string; issuer: string; validTo: string }[];
  users: { id: number; fullName: string; role: Role; active: boolean; gpsSerial: string | null }[];
}
interface Device { deviceId: string; deviceName: string; serial: string; plateNo: string }

/** Administracja → Integracja E-SERVER: dostęp do API GPS i powiązanie handlowców z nadajnikami. */
export function EServerTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['eserver'], queryFn: () => api.get<Config>('/api/admin/eserver') });
  const { data: devices = [], error: devicesError } = useQuery({
    queryKey: ['eserver-devices'], queryFn: () => api.get<Device[]>('/api/admin/eserver/devices'), enabled: Boolean(cfg?.configured), retry: false,
  });
  const [form, setForm] = useState<{ baseUrl: string; login: string; password: string; caPem: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [assignError, setAssignError] = useState<unknown>(null);

  const f = form ?? { baseUrl: cfg?.baseUrl ?? '', login: cfg?.login ?? '', password: '', caPem: cfg?.caPem ?? '' };
  const certError = error instanceof Error && /certyfikat/i.test(error.message);
  const refresh = () => Promise.all(['eserver', 'eserver-devices', 'gps-overview'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function save() {
    setBusy(true); setError(null); setSaved('');
    try {
      const res = await api.put<{ devices: number }>('/api/admin/eserver', { baseUrl: f.baseUrl, login: f.login, password: f.password || undefined, caPem: f.caPem.trim() || null });
      setForm(null);
      setSaved(`Połączono – pojazdów na koncie: ${res.devices}`);
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Wyłączyć integrację E-SERVER? Mapa i statystyki jazdy znikną z pulpitu (przypisania nadajników zostaną zapamiętane).')) return;
    await api.del('/api/admin/eserver');
    setForm(null);
    await refresh();
  }

  async function assign(userId: number, serial: string) {
    setAssignError(null);
    try {
      await api.put('/api/admin/eserver/assign', { userId, serial: serial || null });
      await refresh();
    } catch (err) { setAssignError(err); }
  }

  const people = (cfg?.users ?? []).filter((u) => u.active || u.gpsSerial);
  const deviceLabel = (serial: string) => devices.find((d) => d.serial === serial);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><Satellite size={18} className="text-brand-600" /> Integracja E-SERVER (GPS)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Dane z platformy E-SERVER (Pronal): bieżące lokalizacje pojazdów i statystyki jazdy handlowców na pulpicie kierownika i admina.
          Dostęp do API musi być aktywowany na koncie E-SERVER. Hasło jest zapisywane wyłącznie jako skrót MD5 (tak wymaga API).
        </p>
        {cfg?.configured && !form && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Check size={16} /> Integracja włączona · {cfg.login} @ {cfg.baseUrl}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Adres URL API" className="sm:col-span-3">
            <input className="input" value={f.baseUrl} onChange={(e) => setForm({ ...f, baseUrl: e.target.value })} placeholder="https://e-server.com.pl/api" />
          </Field>
          <Field label="Login">
            <input className="input" value={f.login} onChange={(e) => setForm({ ...f, login: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={cfg?.configured ? 'Hasło (zostaw puste, aby nie zmieniać)' : 'Hasło'}>
            <input className="input" type="password" value={f.password} onChange={(e) => setForm({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={save} disabled={busy || !f.baseUrl || !f.login || (!cfg?.configured && !f.password)}>{busy ? 'Łączę…' : 'Zapisz i sprawdź'}</Button>
            {cfg?.configured && <Button variant="ghost" onClick={remove} title="Wyłącz integrację"><Trash2 size={15} /></Button>}
          </div>
        </div>
        <ErrorText error={error} />
        <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm" open={Boolean(cfg?.caPem) || certError || undefined}>
          <summary className="cursor-pointer font-medium text-slate-700">Zaawansowane: dodatkowe certyfikaty CA (gdy serwer nie wysyła pełnego łańcucha SSL)</summary>
          <div className="mt-2 space-y-2">
            <p className="text-slate-500">
              Aplikacja próbuje sama pobrać brakujący certyfikat pośredni. Jeśli to się nie uda, wklej go tutaj – połączenie nadal jest w pełni weryfikowane.
            </p>
            <ol className="list-decimal space-y-0.5 pl-5 text-slate-500">
              <li>Otwórz w Edge lub Chrome adres <b>https://e-server.com.pl</b> i kliknij ikonę kłódki (lub „ustawienia witryny”) obok adresu.</li>
              <li>„Połączenie jest bezpieczne” → „Certyfikat jest prawidłowy” (ikona certyfikatu).</li>
              <li>Zakładka <b>Szczegóły</b> → w „Hierarchii certyfikatów” zaznacz <b>środkowy</b> certyfikat (pośredni, nie pierwszy i nie ostatni).</li>
              <li><b>Eksportuj…</b> → typ „Base64-encoded ASCII, single certificate” → zapisz plik.</li>
              <li>Otwórz plik w Notatniku, skopiuj całość (z liniami BEGIN/END) i wklej poniżej, potem „Zapisz i sprawdź”.</li>
            </ol>
            <textarea className="input h-32 font-mono text-xs" value={f.caPem} onChange={(e) => setForm({ ...f, caPem: e.target.value })}
              placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'} spellCheck={false} />
            {cfg?.caCerts.map((c, i) => (
              <p key={i} className="text-xs text-slate-500">Zapisany: <b>{c.subject}</b> (wystawca: {c.issuer}, ważny do {new Date(c.validTo).toLocaleDateString('pl-PL')})</p>
            ))}
          </div>
        </details>
        {saved && <p className="mt-2 text-sm text-emerald-600">{saved}</p>}
      </section>

      {cfg?.configured && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-semibold">Nadajniki GPS handlowców</h2>
          <p className="mb-3 text-sm text-slate-500">Wskaż pojazd (nadajnik), którym jeździ każdy handlowiec. Lista pojazdów pochodzi z konta E-SERVER.</p>
          {devicesError ? <div className="mb-3"><ErrorText error={devicesError} /></div> : null}
          <ErrorText error={assignError} />
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {people.map((u) => {
              const dev = u.gpsSerial ? deviceLabel(u.gpsSerial) : null;
              return (
                <div key={u.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <Avatar name={u.fullName} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{u.fullName}</div>
                    <div className="text-xs text-slate-400">{ROLE_LABELS[u.role]}{!u.active ? ' · konto zablokowane' : ''}</div>
                  </div>
                  {devices.length ? (
                    <select className="input w-80 py-1.5 text-sm" value={u.gpsSerial ?? ''} onChange={(e) => assign(u.id, e.target.value)}>
                      <option value="">— brak nadajnika —</option>
                      {u.gpsSerial && !dev && <option value={u.gpsSerial}>{u.gpsSerial} (nie ma na koncie E-SERVER)</option>}
                      {devices.map((d) => <option key={d.serial} value={d.serial}>{d.plateNo || d.deviceName} · {d.serial}</option>)}
                    </select>
                  ) : (
                    <input className="input w-48 py-1.5 text-sm" placeholder="numer nadajnika" defaultValue={u.gpsSerial ?? ''}
                      onBlur={(e) => e.target.value !== (u.gpsSerial ?? '') && assign(u.id, e.target.value)} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
