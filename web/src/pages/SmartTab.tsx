import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Droplets, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, ErrorText, Field } from '../components/ui';

interface Config {
  configured: boolean; authUrl: string; apiUrl: string; login: string; loginDomain: string; clientId: string;
  domainSuffix: string; sort: string; details: string; tagId: number | null; tags: { id: number; name: string }[];
}
type Form = Omit<Config, 'configured' | 'tags'> & { password: string };

/** Administracja → Integracja ze SMART: dane logowania do platformy i tag testowych wodociągów. */
export function SmartTab() {
  const qc = useQueryClient();
  const { data: cfg } = useQuery({ queryKey: ['smart-config'], queryFn: () => api.get<Config>('/api/admin/smart') });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (!cfg) return null;

  const f: Form = form ?? {
    authUrl: cfg.authUrl, apiUrl: cfg.apiUrl, login: cfg.login, password: '', loginDomain: cfg.loginDomain, clientId: cfg.clientId,
    domainSuffix: cfg.domainSuffix, sort: cfg.sort, details: cfg.details, tagId: cfg.tagId,
  };
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm({ ...f, [k]: e.target.value });

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      await api.put('/api/admin/smart', { ...f, password: f.password || undefined });
      setForm(null); setSaved(true);
      await Promise.all(['smart-config', 'tests'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Wyłączyć integrację ze SMART? Zakładka Testy przestanie pokazywać wyniki.')) return;
    await api.del('/api/admin/smart');
    setForm(null);
    await Promise.all(['smart-config', 'tests'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  }

  const ready = f.authUrl && f.apiUrl && f.login && f.loginDomain && f.clientId && (cfg.configured || f.password);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Droplets size={18} className="text-brand-600" /> Integracja ze SMART (testy nakładek)</h2>
      <p className="mb-4 text-sm text-slate-500">
        Dane do zakładki <b>Testy</b>: wyniki raportowania testowych nakładek dla klientów oznaczonych wybranym tagiem.
        Klient musi mieć uzupełnione pole <b>Domena</b> na karcie. Hasło jest potrzebne przy każdym logowaniu do API,
        dlatego jest zapisane w bazie – nie jest pokazywane ani zapisywane w logach.
      </p>
      {cfg.configured && !form && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><Check size={16} /> Integracja włączona · {cfg.login} @ {cfg.loginDomain}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Login"><input className="input" value={f.login} onChange={set('login')} autoComplete="off" /></Field>
        <Field label={cfg.configured ? 'Hasło (zostaw puste, aby nie zmieniać)' : 'Hasło'}>
          <input className="input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="Domena logowania (domain)"><input className="input" value={f.loginDomain} onChange={set('loginDomain')} placeholder="np. rks.smartmetering24.pl" /></Field>
        <Field label="Client ID (client_id)"><input className="input" value={f.clientId} onChange={set('clientId')} autoComplete="off" /></Field>
        <Field label="Tag klientów testowych">
          <select className="input" value={f.tagId ?? ''} onChange={(e) => setForm({ ...f, tagId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">— wybierz tag —</option>
            {cfg.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Końcówka domeny wodociągu"><input className="input" value={f.domainSuffix} onChange={set('domainSuffix')} placeholder=".smartmetering24.pl" /></Field>
      </div>
      <details className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">Adresy i parametry API</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Adres logowania" className="sm:col-span-2"><input className="input" value={f.authUrl} onChange={set('authUrl')} /></Field>
          <Field label="Adres API (rawdata – requestUrl)" className="sm:col-span-2"><input className="input" value={f.apiUrl} onChange={set('apiUrl')} /></Field>
          <Field label="Parametr sort"><input className="input" value={f.sort} onChange={set('sort')} /></Field>
          <Field label="Parametr details (raporty)"><input className="input" value={f.details} onChange={set('details')} /></Field>
        </div>
      </details>
      <div className="mt-3"><ErrorText error={error} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy || !ready}>{busy ? 'Łączę…' : 'Zapisz i sprawdź logowanie'}</Button>
        {cfg.configured && <Button variant="ghost" onClick={remove} title="Wyłącz integrację"><Trash2 size={15} /></Button>}
        {saved && <span className="text-sm text-emerald-600">Zalogowano i zapisano</span>}
      </div>
      {!cfg.tags.length && <p className="mt-3 text-sm text-amber-700">Najpierw utwórz tag dla klientów testowych (zakładka Tagi).</p>}
    </section>
  );
}
