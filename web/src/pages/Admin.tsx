import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { purgeClient, restoreClient } from '../lib/archive';
import { ImportTab } from './ImportTab';
import { EServerTab } from './EServerTab';
import { fmtDateTime, fmtNip } from '../lib/format';
import { Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ArrowDown, ArrowUp, CalendarDays, Check, Eye, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, type CustomField, type FieldType, type Role, type Status, type Tag, type UserRow, type ArchivedClient } from '../lib/api';
import { NAV_DEFAULTS, ROLE_LABELS, useFields, useMe, useNavLabels, useStatuses, useTags, useUsers, type NavLabels } from '../lib/queries';
import { Avatar, Button, ErrorText, Field, Modal, StatusBadge, TagChip } from '../components/ui';
import { AvatarUpload } from '../components/AvatarUpload';
import { LogsTab } from './LogsTab';
import { SmartTab } from './SmartTab';

const TABS = ['Użytkownicy', 'Statusy klienta', 'Tagi', 'Pola klienta', 'Archiwum', 'Integracje', 'Integracja E-SERVER', 'Integracja ze SMART', 'Import', 'Nazwy zakładek', 'Logi'] as const;

export function AdminPage() {
  const { data: me } = useMe();
  // ?tab=eserver – bezpośredni link z pulpitu do ustawień integracji GPS.
  const [params] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>(params.get('tab') === 'eserver' ? 'Integracja E-SERVER' : params.get('tab') === 'smart' ? 'Integracja ze SMART' : 'Użytkownicy');
  const labels = useNavLabels();
  if (me && me.role !== 'ADMIN') return <Navigate to="/" replace />;

  return (
    <div className={`mx-auto px-4 py-6 sm:px-6 ${tab === 'Logi' ? 'max-w-7xl' : 'max-w-5xl'}`}>
      <h1 className="mb-4 text-2xl font-semibold">{labels.admin}</h1>
      <div className="mb-5 flex flex-wrap gap-x-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Użytkownicy' && <UsersTab />}
      {tab === 'Statusy klienta' && <StatusesTab />}
      {tab === 'Tagi' && <TagsTab />}
      {tab === 'Pola klienta' && <FieldsTab />}
      {tab === 'Archiwum' && <ArchiveTab />}
      {tab === 'Integracje' && <IntegrationsTab />}
      {tab === 'Integracja E-SERVER' && <EServerTab />}
      {tab === 'Integracja ze SMART' && <SmartTab />}
      {tab === 'Import' && <ImportTab />}
      {tab === 'Nazwy zakładek' && <NavLabelsTab />}
      {tab === 'Logi' && <LogsTab />}
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
  const { data: me } = useMe();
  const [edit, setEdit] = useState<{ user?: UserRow } | null>(null);
  const [remove, setRemove] = useState<UserRow | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-between">
        <p className="text-sm text-slate-500">Handlowiec widzi i edytuje klientów, których jest opiekunem (dodani przez niego stają się jego), oraz tych, do których admin lub kierownik da mu dostęp na karcie klienta. Kierownik widzi i edytuje wszystkich klientów i zarządza dostępem. Tylko administrator usuwa klientów i zarządza ustawieniami.</p>
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
                <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Avatar name={u.fullName} src={u.avatarUrl} /> <div><div className="font-medium">{u.fullName}</div><div className="text-xs text-slate-400">{u.email}</div></div></div></td>
                <td className="px-4 text-slate-600">{u.login}</td>
                <td className="px-4">{ROLE_LABELS[u.role]}</td>
                <td className="px-4 text-slate-500">{u.googleConnected ? 'połączono' : '—'}</td>
                <td className="px-4">{u.active ? <span className="text-emerald-600">aktywny</span> : <span className="text-slate-400">zablokowany</span>}</td>
                <td className="whitespace-nowrap px-4 text-right">
                  <button onClick={() => setEdit({ user: u })} className="text-slate-400 hover:text-brand-600" title="Edytuj"><Pencil size={15} /></button>
                  {u.id !== me?.id && <button onClick={() => setRemove(u)} className="ml-3 text-slate-400 hover:text-red-600" title="Usuń użytkownika"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {edit && <UserForm user={edit.user} onClose={() => setEdit(null)} />}
      {remove && <DeleteUserDialog user={remove} users={users} onClose={() => setRemove(null)} />}
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
        {user ? <AvatarUpload userId={user.id} name={user.fullName} src={user.avatarUrl} size={64} />
          : <p className="text-xs text-slate-400">Zdjęcie profilowe dodasz po zapisaniu użytkownika.</p>}
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

// ---------------- Tagi ----------------
function TagsTab() {
  const { data: tags = [] } = useTags();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ tag?: Tag } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['tags'] });

  async function remove(t: Tag) {
    if (!confirm(`Usunąć tag "#${t.name}"? Zniknie ze wszystkich klientów.`)) return;
    await api.del(`/api/tags/${t.id}`);
    await refresh();
    qc.invalidateQueries({ queryKey: ['clients'] });
  }

  return (
    <>
      <div className="mb-3 flex justify-between gap-4">
        <p className="text-sm text-slate-500">Tagi służą do opisywania i grupowania klientów (np. filtrowania listy). Handlowcy przypisują je klientom, wybierając z tej listy. Tagi nie wpływają na to, kto widzi klienta – dostęp ustawia się na karcie klienta.</p>
        <Button onClick={() => setEdit({})} className="shrink-0"><Plus size={16} /> Dodaj tag</Button>
      </div>
      <Card>
        {tags.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Brak tagów.</p>}
        {tags.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-sm last:border-0">
            <div className="flex-1"><TagChip name={t.name} color={t.color} /></div>
            <button disabled={i === 0} onClick={() => move(tags.map((x) => x.id), i, -1, '/api/tags-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowUp size={15} /></button>
            <button disabled={i === tags.length - 1} onClick={() => move(tags.map((x) => x.id), i, 1, '/api/tags-order').then(refresh)} className="text-slate-400 hover:text-brand-600 disabled:opacity-30"><ArrowDown size={15} /></button>
            <button onClick={() => setEdit({ tag: t })} className="text-slate-400 hover:text-brand-600"><Pencil size={15} /></button>
            <button onClick={() => remove(t)} className="text-slate-400 hover:text-red-500"><Trash2 size={15} /></button>
          </div>
        ))}
      </Card>
      {edit && <TagForm tag={edit.tag} onClose={() => setEdit(null)} />}
    </>
  );
}

function TagForm({ tag, onClose }: { tag?: Tag; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: tag?.name ?? '', color: tag?.color ?? '#0ea5e9' });
  const [error, setError] = useState<unknown>(null);

  async function save() {
    try {
      if (tag) await api.put(`/api/tags/${tag.id}`, form);
      else await api.post('/api/tags', form);
      await qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      onClose();
    } catch (err) { setError(err); }
  }

  return (
    <Modal title={tag ? 'Edytuj tag' : 'Nowy tag'} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-3">
          <Field label="Nazwa" className="flex-1"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
          <Field label="Kolor"><input type="color" className="h-[38px] w-16 cursor-pointer rounded-lg border border-slate-200" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
        </div>
        <div><span className="label">Podgląd</span><TagChip name={form.name.toLowerCase() || 'tag'} color={form.color} /></div>
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

// ---------------- Archiwum ----------------
function ArchiveTab() {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: () => api.get<ArchivedClient[]>('/api/clients-archive'),
  });
  const refresh = () => Promise.all(['archive', 'clients', 'tasks', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        Zarchiwizowani klienci są niewidoczni w aplikacji (lista, zadania, pulpit). Możesz ich przywrócić albo usunąć trwale.
        Trwałe usunięcie kasuje wszystkie dane klienta: osoby kontaktowe, historię, załączniki, zadania, tagi i ustawienia dostępu.
      </p>
      <Card>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2.5">Klient</th><th className="px-4">Opiekun</th><th className="px-4">Zarchiwizowano</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{c.name}</div>
                  {c.nip && <div className="text-xs text-slate-400">NIP {fmtNip(c.nip)}</div>}
                </td>
                <td className="px-4 text-slate-600">{c.ownerName ?? '—'}</td>
                <td className="px-4 text-slate-600">{fmtDateTime(c.archivedAt)}<div className="text-xs text-slate-400">{c.archivedByName}</div></td>
                <td className="px-4">
                  <div className="flex justify-end gap-1.5">
                    <Link to={`/clients/${c.id}`}><Button variant="ghost" className="px-2 py-1"><Eye size={14} /> Podgląd</Button></Link>
                    <Button variant="secondary" className="px-2 py-1" onClick={async () => { if (await restoreClient(c.id, c.name)) await refresh(); }}>
                      <ArchiveRestore size={14} /> Przywróć
                    </Button>
                    <Button variant="danger" className="px-2 py-1" onClick={async () => { if (await purgeClient(c.id, c.name)) await refresh(); }}>
                      <Trash2 size={14} /> Usuń trwale
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">Archiwum jest puste.</p>}
      </Card>
    </>
  );
}

// ---------------- Integracje ----------------
function IntegrationsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-google'],
    queryFn: () => api.get<{ serviceEmail: string | null; connectedUsers: number }>('/api/admin/google'),
  });
  const [json, setJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-google'] }), qc.invalidateQueries({ queryKey: ['me'] })]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.put('/api/admin/google', { json });
      setJson('');
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Wyłączyć integrację z Kalendarzem Google? Zadania przestaną trafiać do kalendarzy użytkowników.')) return;
    await api.del('/api/admin/google');
    await refresh();
  }

  async function readFile(file: File | undefined) {
    if (file) setJson(await file.text());
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-brand-600" /> Kalendarz Google</h2>
        <p className="mb-4 text-sm text-slate-500">
          Dzięki integracji zadania użytkowników (telefony, spotkania, e-maile) trafiają automatycznie do ich Kalendarzy Google.
          Aplikacja korzysta z jednego <b>konta usługi Google</b>. Każdy użytkownik udostępnia mu swój kalendarz w zakładce Ustawienia.
          Działa w sieci lokalnej, bez domeny i bez logowania użytkowników do Google.
        </p>

        {data?.serviceEmail ? (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <Check size={16} /> Integracja włączona. Konto usługi: <code className="break-all font-medium">{data.serviceEmail}</code>
            </p>
            <p className="text-sm text-slate-600">Połączone kalendarze użytkowników: <b>{data.connectedUsers}</b></p>
            <Button variant="danger" onClick={remove}><Trash2 size={15} /> Wyłącz integrację</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1.5 rounded-xl bg-slate-50 py-3 pl-8 pr-4 text-sm text-slate-600">
              <li>Wejdź na <a className="text-brand-600 hover:underline" href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">console.cloud.google.com</a> i utwórz projekt (np. „SmartCRM”).</li>
              <li>W menu <b>Interfejsy API i usługi → Biblioteka</b> wyszukaj <b>Google Calendar API</b> i kliknij <b>Włącz</b>.</li>
              <li>W menu <b>Administracja (IAM) → Konta usługi</b> utwórz konto usługi (bez dodatkowych ról).</li>
              <li>Na koncie usługi otwórz zakładkę <b>Klucze → Dodaj klucz → Utwórz nowy klucz → JSON</b>. Pobierze się plik .json.</li>
              <li>Wgraj ten plik poniżej. Potem każdy użytkownik połączy swój kalendarz w zakładce <b>Ustawienia</b>.</li>
            </ol>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600">
              <Upload size={18} /> {json ? 'Wczytano plik klucza – kliknij „Zapisz”' : 'Wybierz plik klucza .json'}
              <input type="file" accept=".json,application/json" hidden onChange={(e) => readFile(e.target.files?.[0])} />
            </label>
            <ErrorText error={error} />
            <Button onClick={save} disabled={busy || !json}>{busy ? 'Sprawdzam klucz w Google…' : 'Zapisz'}</Button>
            <p className="text-xs text-slate-400">Klucz jest przechowywany w bazie aplikacji i nigdy nie jest wysyłany do przeglądarki.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const NAV_FIELDS: { key: keyof NavLabels; hint: string }[] = [
  { key: 'dashboard', hint: 'strona startowa' },
  { key: 'clients', hint: 'lista klientów' },
  { key: 'tasks', hint: 'zadania zalogowanej osoby' },
  { key: 'reports', hint: 'widoczna dla kierownika i admina' },
  { key: 'tests', hint: 'wyniki testów nakładek, kierownik i admin' },
  { key: 'settings', hint: 'ustawienia osobiste' },
  { key: 'admin', hint: 'widoczna tylko dla admina' },
];

/** Administracja → Nazwy zakładek: nazwy pozycji menu widoczne dla wszystkich użytkowników. */
function NavLabelsTab() {
  const qc = useQueryClient();
  const labels = useNavLabels();
  const [form, setForm] = useState<NavLabels | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const f = form ?? labels;

  async function save(values: NavLabels) {
    setError(null); setSaved(false);
    try {
      const res = await api.put<NavLabels>('/api/admin/nav-labels', values);
      qc.setQueryData(['nav-labels'], res);
      setForm(null); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) { setError(err); }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-semibold">Nazwy zakładek w menu</h2>
      <p className="mb-4 text-sm text-slate-500">
        Nazwy widzą wszyscy użytkownicy – w menu po lewej i w nagłówkach stron. Puste pole przywraca nazwę domyślną.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {NAV_FIELDS.map(({ key, hint }) => (
          <Field key={key} label={`${NAV_DEFAULTS[key]} (${hint})`}>
            <input className="input" value={f[key]} maxLength={40} placeholder={NAV_DEFAULTS[key]}
              onChange={(e) => setForm({ ...f, [key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="mt-2"><ErrorText error={error} /></div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save(f)} disabled={!form}>Zapisz</Button>
        <Button variant="ghost" onClick={() => save(NAV_DEFAULTS)}>Przywróć domyślne</Button>
        {saved && <span className="text-sm text-emerald-600">Zapisano</span>}
      </div>
    </section>
  );
}

interface DeletePreview { clients: number; openTasks: number; doneTasks: number; activities: number; logs: number }

/** Usunięcie użytkownika: komu przekazać klientów i zadania, anonimizacja logów, potwierdzenie. */
function DeleteUserDialog({ user, users, onClose }: { user: UserRow; users: UserRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: preview, error: previewError } = useQuery({
    queryKey: ['user-delete-preview', user.id],
    queryFn: () => api.get<DeletePreview>(`/api/users/${user.id}/delete-preview`),
  });
  const others = users.filter((u) => u.id !== user.id && u.active);
  const [clientsTo, setClientsTo] = useState('');
  const [tasksTo, setTasksTo] = useState('');
  const [anonymizeLogs, setAnonymizeLogs] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tasks = (preview?.openTasks ?? 0) + (preview?.doneTasks ?? 0);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.del(`/api/users/${user.id}`, {
        clientsTo: clientsTo ? Number(clientsTo) : null,
        tasksTo: tasksTo ? Number(tasksTo) : null,
        anonymizeLogs,
      });
      await Promise.all(['users', 'clients', 'tasks', 'dashboard', 'audit', 'gps-overview'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    } catch (err) { setError(err); setBusy(false); }
  }

  return (
    <Modal title={`Usuń użytkownika: ${user.fullName}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          Konto zostanie usunięte bezpowrotnie. Jeśli chcesz tylko odebrać dostęp, wystarczy zablokować konto (edycja → „Konto aktywne”).
        </p>
        <ErrorText error={previewError} />
        {preview && (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
            <li>Klienci pod opieką: <b className="text-slate-900">{preview.clients}</b></li>
            <li>Zadania otwarte: <b className="text-slate-900">{preview.openTasks}</b>, wykonane: <b className="text-slate-900">{preview.doneTasks}</b></li>
            <li>Wpisy w historii klientów: <b className="text-slate-900">{preview.activities}</b></li>
            <li>Zdarzenia w logach: <b className="text-slate-900">{preview.logs}</b></li>
          </ul>
        )}
        {preview && preview.clients > 0 && (
          <Field label="Klienci tej osoby – nowy opiekun">
            <select className="input" value={clientsTo} onChange={(e) => setClientsTo(e.target.value)}>
              <option value="">— bez opiekuna (widoczni tylko dla admina i kierownika) —</option>
              {others.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({ROLE_LABELS[u.role]})</option>)}
            </select>
          </Field>
        )}
        {tasks > 0 && (
          <Field label="Zadania tej osoby">
            <select className="input" value={tasksTo} onChange={(e) => setTasksTo(e.target.value)}>
              <option value="">— usuń zadania —</option>
              {others.map((u) => <option key={u.id} value={u.id}>przekaż: {u.fullName}</option>)}
            </select>
          </Field>
        )}
        {preview && preview.activities > 0 && (
          <p className="text-slate-500">Wpisy w historii klientów zostaną podpisane imieniem i nazwiskiem tej osoby.</p>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={anonymizeLogs} onChange={(e) => setAnonymizeLogs(e.target.checked)} />
          <span>
            Zanonimizuj w logach (imię i nazwisko, login i e-mail zastąpione „Usunięty użytkownik”).
            <span className="block text-xs text-slate-500">Odznacz, jeśli logi mają nadal pokazywać, kto wykonywał dawne operacje.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 border-t border-slate-100 pt-3">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span className="font-medium">Rozumiem, że tej operacji nie da się cofnąć (poza odtworzeniem kopii zapasowej).</span>
        </label>
        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Anuluj</Button>
          <Button variant="danger" onClick={submit} disabled={!confirmed || !preview || busy}><Trash2 size={15} /> {busy ? 'Usuwam…' : 'Usuń użytkownika'}</Button>
        </div>
      </div>
    </Modal>
  );
}
