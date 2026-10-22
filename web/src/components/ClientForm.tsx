import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type ClientDetail } from '../lib/api';
import { seesAll, useFields, useMe, useStatuses, useUsers, useVoivodeships } from '../lib/queries';
import { Button, ErrorText, Field, Modal } from './ui';
import { CustomFieldInput } from './CustomFieldInput';

interface Props { client?: ClientDetail; onClose: () => void; onSaved: (id: number) => void }

export function ClientForm({ client, onClose, onSaved }: Props) {
  const { data: me } = useMe();
  const { data: statuses = [] } = useStatuses();
  const { data: fields = [] } = useFields();
  const { data: users = [] } = useUsers();
  const { data: voivodeships = [] } = useVoivodeships();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: client?.name ?? '',
    nip: client?.nip ?? '',
    voivodeship: client?.voivodeship ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    potential: client?.potential?.toString() ?? '',
    currentSolution: client?.currentSolution ?? '',
    description: client?.description ?? '',
    statusId: client?.statusId?.toString() ?? statuses.find((s) => s.active)?.id.toString() ?? '',
    ownerId: client?.ownerId?.toString() ?? me?.id.toString() ?? '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>(client?.custom ?? {});
  const [contact, setContact] = useState({ name: '', position: '', phone: '', email: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const activeFields = fields.filter((f) => f.active);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      voivodeship: form.voivodeship || null,
      potential: form.potential === '' ? null : Number(form.potential),
      statusId: form.statusId ? Number(form.statusId) : null,
      ownerId: seesAll(me) && form.ownerId ? Number(form.ownerId) : undefined,
      custom,
    };
    try {
      let id = client?.id;
      if (client) await api.put(`/api/clients/${client.id}`, payload);
      else id = (await api.post<{ id: number }>('/api/clients', { ...payload, contact: contact.name ? contact : undefined })).id;
      await qc.invalidateQueries({ queryKey: ['clients'] });
      await qc.invalidateQueries({ queryKey: ['client', id] });
      await qc.invalidateQueries({ queryKey: ['activities', id] });
      onSaved(id!);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={client ? 'Edytuj klienta' : 'Nowy klient'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nazwa *" className="sm:col-span-2"><input className="input" value={form.name} onChange={set('name')} autoFocus /></Field>
          <Field label="NIP"><input className="input" value={form.nip} onChange={set('nip')} placeholder="000-000-00-00" /></Field>
          <Field label="Województwo">
            <select className="input" value={form.voivodeship} onChange={set('voivodeship')}>
              <option value="">—</option>
              {voivodeships.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Telefon"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Potencjał ilościowy zakupu"><input className="input" type="number" min={0} value={form.potential} onChange={set('potential')} /></Field>
          <Field label="Status klienta">
            <select className="input" value={form.statusId} onChange={set('statusId')}>
              <option value="">—</option>
              {statuses.filter((s) => s.active || s.id === client?.statusId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Aktualne rozwiązanie" className="sm:col-span-2"><input className="input" value={form.currentSolution} onChange={set('currentSolution')} /></Field>
          <Field label="Krótki opis" className="sm:col-span-2"><textarea className="input" rows={3} value={form.description} onChange={set('description')} /></Field>
          {seesAll(me) && (
            <Field label="Opiekun (handlowiec)">
              <select className="input" value={form.ownerId} onChange={set('ownerId')}>
                {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </Field>
          )}
        </div>

        {activeFields.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Pola dodatkowe</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {activeFields.map((f) => (
                <Field key={f.id} label={f.label} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <CustomFieldInput field={f} value={custom[f.key]} onChange={(v) => setCustom((c) => ({ ...c, [f.key]: v }))} />
                </Field>
              ))}
            </div>
          </div>
        )}

        {!client && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Osoba kontaktowa</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Imię i nazwisko"><input className="input" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></Field>
              <Field label="Stanowisko"><input className="input" value={contact.position} onChange={(e) => setContact({ ...contact, position: e.target.value })} /></Field>
              <Field label="Telefon"><input className="input" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></Field>
              <Field label="E-mail"><input className="input" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></Field>
            </div>
          </div>
        )}

        <ErrorText error={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Anuluj</Button>
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Zapisywanie…' : 'Zapisz'}</Button>
        </div>
      </form>
    </Modal>
  );
}
