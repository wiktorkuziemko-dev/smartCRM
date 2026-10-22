import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, type CustomField, type FieldType, type Role, type Status, type UserRow } from '../lib/api';
import { ROLE_LABELS, useFields, useMe, useStatuses, useUsers } from '../lib/queries';
import { Avatar, Button, ErrorText, Field, Modal, StatusBadge } from '../components/ui';

const TABS = ['Użytkownicy', 'Statusy klienta', 'Pola klienta'] as const;

export function AdminPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Użytkownicy');
  if (me && me.role !== 'ADMIN') return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-2xl font-semibold">Administracja</h1>
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Użytkownicy' && <UsersTab />}
      {tab === 'Statusy klienta' && <StatusesTab />}
      {tab === 'Pola klienta' && <FieldsTab />}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{children}</div>;
}

/** Wspólna logika zmiany kolejności (strzałki góra/dół). */
async function move(ids: number[], index: number, dir: -1 | 1, url: string) {
  const next = [...ids];
  const j = index + dir;
  if (j < 0 || j >= next.length) return;
  [next[index], next[j]] = [next[j], next[index]];
  await api.put(url, { ids: next });
}

// ---------------- Użytkownicy ----------------
function UsersTab() {
  const { data: users = [] } = useUsers();
  const [edit, setEdit] = useState<{ user?: UserRow } | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-between">
        <p className="text-sm text-slate-500">Handlowiec widzi tylko swoich klientów. Kierownik widzi wszystkich i może zmieniać opiekunów. Administrator dodatkowo zarządza ustawieniami.</p>
        <Button onClick={() => setEdit({})} className="shrink-0"><Plus size={16} /> Dodaj użytkownika</Button>
      </div>
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2.5">Użytkownik</th><th className="px-4">Login</th><th className="px-4">Rola</th><th className="px-4">Google</th><th className="px-4">Status</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Avatar name={u.fullName} /> <div><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-400">{u.email}</div></div></div></td>
                <td className="px-4 text-slate-600">{u.login}</td>
                <td className="px-4">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 text-slate-500">{u.googleConnected ? 'połączono' : '—'}</td>
                <td className="px-4">{u.active ? <span className="text-emerald-600">aktywny</span> : <span className="text-slate-400">zablokowany</span>}</td>
                <td className="px-4 text-right"><button onClick={() => setEdit({ user: u })} className="text-slate-400 hover:text-brand-600"><Pencil size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <UserForm user={edit.user} onClose={() => setEdit(null)} />}
    </>
  );
}

function UserForm({ user, onClose }: { user?: UserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    login: user?.login ?? '', fullName: user?.fullName ?? '', email: user?.email ?? '',
    role: user?.role ?? ('SALES' as Role), active: user?.active ?? true, password: '',
  });
  const [error, setError] = useState<unknown>(null);

  async function save() {
    try {
      if (user) {
        const { login: _, password, ...rest } = form;
        await api.put(`/api/users/${user.id}`, { ...rest, ...(password ? { password } : {}) });
      } else {
        const { active: _, ...rest } = form;
        await api.post('/api/users', rest);
      }
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal title={user ? 'Edytuj użytkownika' : 'Nowy użytkownik'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Imię i nazwisko"><input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Login"><input className="input" value={form.login} disabled={Boolean(user)} onChange={(e) => setForm({ ...form, login: e.target.value })} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Rola">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label={user ? 'Nowe hasło (opcjonalnie)' : 'Hasło (min. 8 znaków)'}>
            <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        </div>
        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Konto aktywne (odznacz, aby zablokować logowanie)
          </label>
        )}
        <ErrorText error={error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Anuluj</Button>
          <Button onClick={save} disabled={!form.fullName || !form.login || (!user && form.password.length < 8)}>Zapisz</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Statusy ----------------
function StatusesTab() {
  const { data: statuses = [] } = useStatuses();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ status?: Status } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['statuses'] });

  async function remove(s: Status) {
    if (!confirm(`Usunąć status "${s.name}"?`)) return;
    try { setError(null); await api.del(`/api/statuses/${s.id}`); await refresh(); } catch (err) { setError(err); }
  }

  return (
    <>
      <div className="mb-3 flex justify-between gap-4">
        <p className="text-sm text-slate-500">Stopnie lejka w kolejności od pierwszego kontaktu do finalizacji. Handlowcy wybierają status tylko z tej listy. Nieaktywny status nie jest dostępny do wyboru, ale klienci, którzy go mają, zachowują go.</p>
        <Button onClick={() => setEdit({})} className="shrink-0"><Plus size={16} /> Dodaj status</Button>
      </div>
      <ErrorText error={error} />
      <Card>
        {statuses.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0">
            <span className="w-6 text-sm text-slate-400">{i + 1}.</span>
            <div className="flex-1"><StatusBadge name={s.name} color={s.color} />{!s.active && <span className="ml-2 text-xs text-slate-400">(nieaktywny)</span>}</div>
            <button disabled={i === 0} onClick={() => move(statuses.map((x) => x.id), i, -1, '/api/statuses-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowUp size={15} /></button>
            <button disabled={i === statuses.length - 1} onClick={() => move(statuses.map((x) => x.id), i, 1, '/api/statuses-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowDown size={15} /></button>
            <button onClick={() => setEdit({ status: s })} className="text-slate-400 hover:text-brand-600"><Pencil size={15} /></button>
            <button onClick={() => remove(s)} className="text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
          </div>
        ))}
      </Card>
      {edit && <StatusForm status={edit.status} onClose={() => setEdit(null)} />}
    </>
  );
}

function StatusForm({ status, onClose }: { status?: Status; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: status?.name ?? '', color: status?.color ?? '#3b82f6', active: status?.active ?? true });
  const [error, setError] = useState<unknown>(null);
  async function save() {
    try {
      if (status) await api.put(`/api/statuses/${status.id}`, form);
      else await api.post('/api/statuses', { name: form.name, color: form.color });
      await qc.invalidateQueries({ queryKey: ['statuses'] });
      onClose();
    } catch (err) { setError(err); }
  }
  return (
    <Modal title={status ? 'Edytuj status' : 'Nowy status'} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-3">
          <Field label="Nazwa" className="flex-1"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Kolor"><input type="color" className="h-[38px] w-16 cursor-pointer rounded-lg border border-slate-200" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
        </div>
        {status && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktywny
          </label>
        )}
        <div><span className="label">Podgląd</span><StatusBadge name={form.name || 'Status'} color={form.color} /></div>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Anuluj</Button><Button onClick={save} disabled={!form.name.trim()}>Zapisz</Button></div>
      </div>
    </Modal>
  );
}

// ---------------- Pola dodatkowe ----------------
const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Tekst', textarea: 'Tekst wielowierszowy', number: 'Liczba', date: 'Data', select: 'Lista wyboru', checkbox: 'Tak / Nie',
};

function FieldsTab() {
  const { data: fields = [] } = useFields();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ field?: CustomField } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['fields'] });

  async function remove(f: CustomField) {
    if (!confirm(`Usunąć pole "${f.label}"? Wartości przestaną być widoczne. Jeśli chcesz je zachować, lepiej oznacz pole jako nieaktywne.`)) return;
    await api.del(`/api/fields/${f.id}`);
    await refresh();
  }

  return (
    <>
      <div className="mb-3 flex justify-between gap-4">
        <p className="text-sm text-slate-500">Dodatkowe pola na karcie klienta (oprócz pól podstawowych). Pola z opcją „na liście” pojawiają się jako kolumny w tabeli klientów, z sortowaniem, filtrowaniem i eksportem.</p>
        <Button onClick={() => setEdit({})} className="shrink-0"><Plus size={16} /> Dodaj pole</Button>
      </div>
      <Card>
        {fields.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Brak pól dodatkowych.</p>}
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0">
            <div className="flex-1">
              <span className="font-medium">{f.label}</span>
              <span className="ml-2 text-slate-400">{TYPE_LABELS[f.type]}{f.type === 'select' && `: ${f.options.join(', ')}`}</span>
              {f.showInList && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-600">na liście</span>}
              {!f.active && <span className="ml-2 text-xs text-slate-400">(nieaktywne)</span>}
            </div>
            <button disabled={i === 0} onClick={() => move(fields.map((x) => x.id), i, -1, '/api/fields-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowUp size={15} /></button>
            <button disabled={i === fields.length - 1} onClick={() => move(fields.map((x) => x.id), i, 1, '/api/fields-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowDown size={15} /></button>
            <button onClick={() => setEdit({ field: f })} className="text-slate-400 hover:text-brand-600"><Pencil size={15} /></button>
            <button onClick={() => remove(f)} className="text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
          </div>
        ))}
      </Card>
      {edit && <FieldForm field={edit.field} onClose={() => setEdit(null)} />}
    </>
  );
}

function FieldForm({ field, onClose }: { field?: CustomField; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    label: field?.label ?? '', type: field?.type ?? ('text' as FieldType),
    options: field?.options.join('\n') ?? '', showInList: field?.showInList ?? true, active: field?.active ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  async function save() {
    const payload = { ...form, options: form.type === 'select' ? form.options.split('\n').map((o) => o.trim()).filter(Boolean) : [] };
    try {
      if (field) await api.put(`/api/fields/${field.id}`, payload);
      else await api.post('/api/fields', payload);
      await qc.invalidateQueries({ queryKey: ['fields'] });
      onClose();
    } catch (err) { setError(err); }
  }
  return (
    <Modal title={field ? 'Edytuj pole' : 'Nowe pole'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nazwa pola"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus /></Field>
        <Field label="Typ">
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as FieldType })}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {form.type === 'select' && (
          <Field label="Opcje (każda w osobnej linii)"><textarea className="input" rows={4} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} /></Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.showInList} onChange={(e) => setForm({ ...form, showInList: e.target.checked })} /> Pokazuj jako kolumnę na liście klientów</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktywne</label>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Anuluj</Button><Button onClick={save} disabled={!form.label.trim()}>Zapisz</Button></div>
      </div>
    </Modal>
  );
}
