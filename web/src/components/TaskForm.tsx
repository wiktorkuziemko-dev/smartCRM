import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { api, type Task, type TaskType } from '../lib/api';
import { googleCalendarLink, isPastInput, toLocalInput } from '../lib/format';
import { seesAll, useClients, useMe, useUsers } from '../lib/queries';
import { Button, ErrorText, Field, Modal } from './ui';

interface Props { task?: Task; clientId?: number; onClose: () => void }

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

export function TaskForm({ task, clientId, onClose }: Props) {
  const { data: me } = useMe();
  const { data: users = [] } = useUsers();
  const { data: clients = [] } = useClients();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: task?.title ?? '',
    type: task?.type ?? ('task' as TaskType),
    notes: task?.notes ?? '',
    dueAt: toLocalInput(task ? new Date(task.dueAt) : defaultDue()),
    clientId: (task?.clientId ?? clientId)?.toString() ?? '',
    assigneeId: (task?.assigneeId ?? me?.id)?.toString() ?? '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['tasks'] }),
    qc.invalidateQueries({ queryKey: ['clients'] }),
    qc.invalidateQueries({ queryKey: ['activities'] }),
  ]);

  // Wsteczny termin zablokowany; zaległe zadanie można edytować bez zmiany terminu.
  const dueChanged = !task || form.dueAt !== toLocalInput(new Date(task.dueAt));
  const duePast = dueChanged && isPastInput(form.dueAt);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      title: form.title,
      type: form.type,
      notes: form.notes,
      dueAt: new Date(form.dueAt).toISOString(),
      clientId: form.clientId ? Number(form.clientId) : null,
      assigneeId: seesAll(me) ? Number(form.assigneeId) : undefined,
    };
    try {
      if (task) await api.put(`/api/tasks/${task.id}`, payload);
      else await api.post('/api/tasks', payload);
      await refresh();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !confirm('Usunąć zadanie?')) return;
    await api.del(`/api/tasks/${task.id}`);
    await refresh();
    onClose();
  }

  const clientName = clients.find((c) => c.id === Number(form.clientId))?.name;
  const calTitle = clientName ? `${form.title} – ${clientName}` : form.title;
  const assignee = users.find((u) => u.id === Number(form.assigneeId));

  return (
    <Modal title={task ? 'Edytuj zadanie' : 'Nowe zadanie'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Tytuł *"><input className="input" value={form.title} onChange={set('title')} autoFocus placeholder="np. Zadzwonić w sprawie oferty" /></Field>
        <Field label="Rodzaj">
          <select className="input" value={form.type} onChange={set('type')}>
            <option value="task">Zadanie</option>
            <option value="call">Telefon</option>
            <option value="meeting">Spotkanie</option>
            <option value="email">E-mail</option>
          </select>
        </Field>
        <Field label="Termin *">
          <input className={`input ${duePast ? 'border-red-400 ring-2 ring-red-100' : ''}`} type="datetime-local" value={form.dueAt}
            min={toLocalInput(new Date())} onChange={set('dueAt')} />
          {duePast && <span className="mt-1 block text-xs text-red-600">Termin nie może być w przeszłości</span>}
        </Field>
        <Field label="Klient">
          <select className="input" value={form.clientId} onChange={set('clientId')} disabled={Boolean(clientId)}>
            <option value="">— bez klienta —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {seesAll(me) && (
          <Field label="Osoba odpowiedzialna">
            <select className="input" value={form.assigneeId} onChange={set('assigneeId')}>
              {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </select>
          </Field>
        )}
        <Field label="Notatki"><textarea className="input" rows={3} value={form.notes} onChange={set('notes')} /></Field>
        <ErrorText error={error} />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {task && <Button type="button" variant="danger" onClick={remove}><Trash2 size={15} /> Usuń</Button>}
          {form.title && form.dueAt && (!me?.googleCalendarEmail || assignee?.id !== me.id) && (
            <a className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm text-brand-600 hover:bg-brand-50"
              href={googleCalendarLink(calTitle, new Date(form.dueAt).toISOString(), form.notes)} target="_blank" rel="noreferrer">
              <CalendarPlus size={15} /> Dodaj do Kalendarza Google
            </a>
          )}
          <div className="flex-1" />
          <Button type="button" variant="secondary" onClick={onClose}>Anuluj</Button>
          <Button type="submit" disabled={busy || !form.title.trim() || !form.dueAt || duePast}>{busy ? 'Zapisywanie…' : 'Zapisz'}</Button>
        </div>
        {me?.googleCalendarEmail && assignee?.id === me.id && (
          <p className="text-xs text-slate-400">Zadanie zostanie automatycznie dodane do Twojego Kalendarza Google ({me.googleCalendarEmail}).</p>
        )}
      </form>
    </Modal>
  );
}
