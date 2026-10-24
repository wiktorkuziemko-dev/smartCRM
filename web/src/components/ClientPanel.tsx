import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Briefcase, Eye, Lock, Mail, Pencil, Phone, Plus, Star, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { api, type AccessLevel, type ClientDetail, type Contact, type Task } from '../lib/api';
import { fmtDateTime, fmtNip, fmtNumber } from '../lib/format';
import { purgeClient, restoreClient } from '../lib/archive';
import { seesAll, useFields, useMe, useStatuses, useTags, useTasks, useUsers } from '../lib/queries';
import { ActivityFeed } from './ActivityFeed';
import { ClientForm } from './ClientForm';
import { formatCustomValue } from './CustomFieldInput';
import { TaskForm } from './TaskForm';
import { TaskItem } from './TaskItem';
import { Avatar, Button, Empty, ErrorText, Field, Modal, TagPicker } from './ui';

export function ClientPanel({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const { data: me } = useMe();
  const { data: client, error } = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.get<ClientDetail>(`/api/clients/${clientId}`),
  });
  const { data: fields = [] } = useFields();
  const { data: tasks = [] } = useTasks({ clientId, status: 'open' });
  const [editing, setEditing] = useState(false);
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null);
  const [contactForm, setContactForm] = useState<{ contact?: Contact } | null>(null);
  const qc = useQueryClient();

  if (error) return <div className="p-6"><ErrorText error={error} /></div>;
  if (!client) return <div className="p-6 text-sm text-slate-400">Ładowanie…</div>;

  const canEdit = client.canEdit;
  const primary = client.contacts.find((c) => c.isPrimary) ?? client.contacts[0];
  const others = client.contacts.filter((c) => c !== primary);

  const archived = Boolean(client.archivedAt);
  const refreshAll = () => Promise.all(['clients', 'client', 'archive', 'tasks', 'dashboard', 'activities'].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  async function archive() {
    if (!confirm(`Przenieść klienta „${client!.name}” do archiwum?\n\nKlient zniknie z listy i zadań wszystkich użytkowników. Administrator może go przywrócić w zakładce Administracja → Archiwum.`)) return;
    await api.del(`/api/clients/${clientId}`);
    await refreshAll();
    onClose();
  }
  async function restore() {
    if (await restoreClient(clientId, client!.name)) await refreshAll();
  }
  async function purge() {
    if (!(await purgeClient(clientId, client!.name))) return;
    await refreshAll();
    onClose();
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Nagłówek */}
      <div className="bg-brand-gradient px-5 pb-4 pt-4 text-white">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold leading-tight">{client.name}</h2>
            <p className="mt-0.5 text-sm text-white/75">
              {[client.nip && `NIP ${fmtNip(client.nip)}`, client.voivodeship, client.ownerName && `Opiekun: ${client.ownerName}`].filter(Boolean).join(' · ')}
            </p>
            <HeaderTags client={client} canEdit={canEdit} />
          </div>
          {canEdit && <button onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white" title="Edytuj"><Pencil size={17} /></button>}
          {me?.role === 'ADMIN' && !archived && <button onClick={archive} className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white" title="Przenieś do archiwum"><Archive size={17} /></button>}
          <button onClick={onClose} className="rounded-lg p-1.5 text-white/80 hover:bg-white/15 hover:text-white" title="Zamknij"><X size={18} /></button>
        </div>

        {/* Osoba kontaktowa */}
        <div className="mt-4 rounded-xl bg-white/15 p-3 backdrop-blur">
          {primary ? (
            <div className="flex items-center gap-3">
              <Avatar name={primary.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{primary.name}</div>
                {primary.position && <div className="text-xs text-white/75">{primary.position}</div>}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {primary.phone && <a href={`tel:${primary.phone}`} className="inline-flex items-center gap-1 hover:underline"><Phone size={13} />{primary.phone}</a>}
                  {primary.email && <a href={`mailto:${primary.email}`} className="inline-flex items-center gap-1 hover:underline"><Mail size={13} />{primary.email}</a>}
                </div>
              </div>
              {canEdit && <button onClick={() => setContactForm({ contact: primary })} className="self-start rounded-md p-1 text-white/70 hover:bg-white/15 hover:text-white"><Pencil size={14} /></button>}
            </div>
          ) : !canEdit ? (
            <span className="text-sm text-white/75">Brak osoby kontaktowej</span>
          ) : (
            <button onClick={() => setContactForm({})} className="inline-flex items-center gap-1 text-sm text-white/90 hover:underline"><Plus size={14} /> Dodaj osobę kontaktową</button>
          )}
        </div>
      </div>

      {archived ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-300 bg-slate-100 px-5 py-2.5 text-sm text-slate-700">
          <Archive size={15} /> <span className="flex-1">Klient w archiwum od {fmtDateTime(client.archivedAt!)}.</span>
          <Button variant="secondary" className="px-2.5 py-1" onClick={restore}><ArchiveRestore size={14} /> Przywróć</Button>
          <Button variant="danger" className="px-2.5 py-1" onClick={purge}><Trash2 size={14} /> Usuń trwale</Button>
        </div>
      ) : !canEdit && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-800">
          <Lock size={15} /> Tylko podgląd – nie możesz edytować tego klienta.
        </div>
      )}

      <div className="flex-1 space-y-6 px-5 pt-5">
        <StatusStepper client={client} canEdit={canEdit} />

        {client.description && (
          <Section title="Opis"><p className="whitespace-pre-wrap text-sm text-slate-700">{client.description}</p></Section>
        )}

        <Section title="Szczegóły">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <Detail label="Potencjał ilościowy">{fmtNumber(client.potential)}</Detail>
            <Detail label="Aktualne rozwiązanie">{client.currentSolution}</Detail>
            <Detail label="E-mail">{client.email && <a className="text-brand-600 hover:underline" href={`mailto:${client.email}`}>{client.email}</a>}</Detail>
            <Detail label="Telefon">{client.phone && <a className="text-brand-600 hover:underline" href={`tel:${client.phone}`}>{client.phone}</a>}</Detail>
            {fields.filter((f) => f.active).map((f) => (
              <Detail key={f.id} label={f.label}>{formatCustomValue(f, client.custom[f.key])}</Detail>
            ))}
            <Detail label="Ostatnia zmiana">{fmtDateTime(client.updatedAt)}</Detail>
          </dl>
        </Section>

        <Section title={`Osoby kontaktowe (${client.contacts.length})`} action={canEdit && <button onClick={() => setContactForm({})} className="text-brand-600 hover:text-brand-700"><Plus size={16} /></button>}>
          {others.length === 0 ? <p className="text-sm text-slate-400">{primary ? 'Brak innych osób.' : 'Brak osób kontaktowych.'}</p> : (
            <div className="space-y-2">
              {others.map((c) => (
                <div key={c.id} className="flex items-center gap-3 text-sm">
                  <Avatar name={c.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{c.name} {c.position && <span className="font-normal text-slate-500">· {c.position}</span>}</div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                      {c.phone && <a href={`tel:${c.phone}`} className="hover:text-brand-600">{c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`} className="hover:text-brand-600">{c.email}</a>}
                    </div>
                  </div>
                  {canEdit && <button onClick={() => setContactForm({ contact: c })} className="text-slate-400 hover:text-brand-600"><Pencil size={14} /></button>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {me?.role === 'ADMIN' && !archived && <VisibilitySection client={client} />}

        {/* Zadania planuje się z historii kontaktów (telefon / spotkanie / e-mail) – tu tylko podgląd i odhaczanie. */}
        <Section title={`Zaplanowane (${tasks.length})`}>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {tasks.length === 0 ? <Empty>{canEdit ? 'Brak zaplanowanych kontaktów – dodaj telefon, spotkanie lub e-mail w historii poniżej.' : 'Brak zaplanowanych kontaktów.'}</Empty> : tasks.map((t) => (
              <TaskItem key={t.id} task={t} showClient={false} showAssignee={seesAll(me)} onOpen={() => setTaskForm({ task: t })} />
            ))}
          </div>
        </Section>

        <Section title="Historia kontaktów">
          <ActivityFeed clientId={clientId} ownerId={client.ownerId} readOnly={!canEdit} />
        </Section>
      </div>

      {editing && <ClientForm client={client} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {taskForm?.task && <TaskForm task={taskForm.task} clientId={clientId} onClose={() => setTaskForm(null)} />}
      {contactForm && <ContactForm clientId={clientId} contact={contactForm.contact} onClose={() => setContactForm(null)} />}
    </div>
  );
}

/** Tagi w nagłówku panelu – handlowiec może je szybko zmienić. */
function HeaderTags({ client, canEdit }: { client: ClientDetail; canEdit: boolean }) {
  const { data: tags = [] } = useTags();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const current = tags.filter((t) => client.tagIds.includes(t.id));

  async function save(tagIds: number[]) {
    await api.put(`/api/clients/${client.id}`, { tagIds });
    await Promise.all(['client', 'activities'].map((k) => qc.invalidateQueries({ queryKey: [k, client.id] })));
    qc.invalidateQueries({ queryKey: ['clients'] });
  }

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-1.5">
      {current.map((t) => (
        <span key={t.id} className="rounded-md bg-white/90 px-1.5 py-0.5 text-xs font-medium" style={{ color: t.color }}>#{t.name}</span>
      ))}
      {canEdit && (
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-white/30 px-1.5 py-0.5 text-xs text-white/85 hover:bg-white/15">
          <TagIcon size={11} /> {current.length ? 'Zmień' : 'Dodaj tag'}
        </button>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 text-slate-700 shadow-xl">
            <div className="mb-2 text-xs font-medium text-slate-500">Tagi klienta</div>
            <TagPicker tags={tags} value={client.tagIds} onChange={save} />
          </div>
        </>
      )}
    </div>
  );
}

const LEVELS: { level: AccessLevel; label: string }[] = [
  { level: 'none', label: 'Brak' },
  { level: 'view', label: 'Podgląd' },
  { level: 'edit', label: 'Edycja' },
];
const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

/** Admin: poziom dostępu każdego handlowca do tego klienta (brak / podgląd / pełna edycja). */
function VisibilitySection({ client }: { client: ClientDetail }) {
  const { data: users = [] } = useUsers();
  const { data: tags = [] } = useTags();
  const qc = useQueryClient();
  const sales = users.filter((u) => u.role === 'SALES' && u.active && u.id !== client.ownerId);
  const rules = new Map((client.accessRules ?? []).map((r) => [r.userId, r.level]));

  // Poziom wynikający z tagów klienta (ustawienia w Administracja → Tagi).
  function fromTags(userId: number): { level: AccessLevel; tags: string[] } {
    let level: AccessLevel = 'none';
    const names: string[] = [];
    for (const t of tags.filter((t) => client.tagIds.includes(t.id))) {
      const a = t.access?.find((x) => x.userId === userId);
      if (!a) continue;
      names.push(t.name);
      if (LEVEL_RANK[a.level] > LEVEL_RANK[level]) level = a.level;
    }
    return { level, tags: names };
  }

  async function set(userId: number, level: AccessLevel | null) {
    await api.put(`/api/clients/${client.id}/access/${userId}`, { level });
    await qc.invalidateQueries({ queryKey: ['client', client.id] });
  }

  return (
    <Section title="Dostęp handlowców">
      <p className="mb-2 text-xs text-slate-500">
        Opiekun (<b>{client.ownerName ?? 'brak'}</b>) ma zawsze pełną edycję, a kierownicy i administratorzy widzą wszystkich klientów.
        Ustawienie tutaj ma pierwszeństwo przed dostępem z tagów.
      </p>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {sales.map((u) => {
          const explicit = rules.get(u.id);
          const tag = fromTags(u.id);
          const effective = explicit ?? tag.level;
          return (
            <div key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Avatar name={u.fullName} size={24} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{u.fullName}</div>
                <div className="text-xs text-slate-400">
                  {explicit
                    ? <>ustawione ręcznie · <button onClick={() => set(u.id, null)} className="text-brand-600 hover:underline">wg tagów</button></>
                    : tag.tags.length ? `z tagu ${tag.tags.map((n) => `#${n}`).join(', ')}` : 'domyślnie'}
                </div>
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {LEVELS.map(({ level, label }) => (
                  <button key={level} onClick={() => set(u.id, level)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${effective === level
                      ? `${level === 'none' ? 'bg-white text-slate-700' : level === 'view' ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white'} shadow-sm ${explicit ? '' : 'opacity-70'}`
                      : 'text-slate-500 hover:text-slate-800'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {sales.length === 0 && <p className="flex items-center gap-1.5 px-3 py-3 text-sm text-slate-400"><Eye size={14} /> Brak innych handlowców.</p>}
      </div>
    </Section>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="break-words text-slate-700">{children || <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

/** Lejek: stopnie statusu zdefiniowane przez admina; kliknięcie zmienia status. */
function StatusStepper({ client, canEdit }: { client: ClientDetail; canEdit: boolean }) {
  const { data: statuses = [] } = useStatuses();
  const qc = useQueryClient();
  const visible = statuses.filter((s) => s.active || s.id === client.statusId);
  const currentIndex = visible.findIndex((s) => s.id === client.statusId);

  async function change(statusId: number) {
    if (!canEdit || statusId === client.statusId) return;
    await api.put(`/api/clients/${client.id}`, { statusId });
    await Promise.all(['client', 'activities'].map((k) => qc.invalidateQueries({ queryKey: [k, client.id] })));
    qc.invalidateQueries({ queryKey: ['clients'] });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status w lejku</h3>
        <span className="text-sm font-medium" style={{ color: visible[currentIndex]?.color }}>{visible[currentIndex]?.name ?? 'Brak statusu'}</span>
      </div>
      <div className="flex gap-1">
        {visible.map((s, i) => (
          <button key={s.id} onClick={() => change(s.id)} title={s.name}
            className={`group relative h-2.5 flex-1 rounded-full transition ${canEdit ? 'hover:scale-y-150' : 'cursor-default'}`}
            style={{ backgroundColor: i <= currentIndex ? visible[currentIndex].color : '#e2e8f0' }}>
            <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white group-hover:block">{s.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ContactForm({ clientId, contact, onClose }: { clientId: number; contact?: Contact; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: contact?.name ?? '', position: contact?.position ?? '', phone: contact?.phone ?? '',
    email: contact?.email ?? '', isPrimary: contact?.isPrimary ?? false,
  });
  const [error, setError] = useState<unknown>(null);
  const set = (k: 'name' | 'position' | 'phone' | 'email') => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['client', clientId] });
    qc.invalidateQueries({ queryKey: ['clients'] });
    onClose();
  };

  async function save() {
    try {
      if (contact) await api.put(`/api/contacts/${contact.id}`, form);
      else await api.post(`/api/clients/${clientId}/contacts`, form);
      await done();
    } catch (err) { setError(err); }
  }

  async function remove() {
    if (!contact || !confirm(`Usunąć osobę kontaktową ${contact.name}?`)) return;
    await api.del(`/api/contacts/${contact.id}`);
    await done();
  }

  return (
    <Modal title={contact ? 'Osoba kontaktowa' : 'Nowa osoba kontaktowa'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Imię i nazwisko *"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Stanowisko"><input className="input" value={form.position} onChange={set('position')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Telefon"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
          <Star size={14} className="text-amber-500" /> Główna osoba kontaktowa
        </label>
        <ErrorText error={error} />
        <div className="flex gap-2 pt-1">
          {contact && <Button variant="danger" onClick={remove}><Trash2 size={15} /> Usuń</Button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Anuluj</Button>
          <Button onClick={save} disabled={!form.name.trim()}><Briefcase size={15} /> Zapisz</Button>
        </div>
      </div>
    </Modal>
  );
}
