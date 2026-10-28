import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CalendarClock, Check, FileText, Info, Mail, MessageSquare, Paperclip, Phone, Send, Trash2, Users, X } from 'lucide-react';
import { api, type Activity, type ActivityType } from '../lib/api';
import { fmtDay, fmtDateTime, fmtDue, fmtSize, isOverdue, isPastInput, toLocalInput } from '../lib/format';
import { seesAll, useMe, useUsers } from '../lib/queries';
import { Avatar, Button, ErrorText } from './ui';

const TYPES: { type: ActivityType; label: string; icon: typeof Phone }[] = [
  { type: 'comment', label: 'Komentarz', icon: MessageSquare },
  { type: 'call', label: 'Telefon', icon: Phone },
  { type: 'meeting', label: 'Spotkanie', icon: Users },
  { type: 'email', label: 'E-mail', icon: Mail },
];
const PLANNED = new Set<ActivityType>(['call', 'meeting', 'email']);
const PLACEHOLDERS: Partial<Record<ActivityType, string>> = {
  comment: 'Dodaj notatkę lub komentarz… (Ctrl+Enter wysyła, możesz wkleić lub przeciągnąć plik)',
  call: 'W jakiej sprawie telefon? (opcjonalnie) np. Zapytać o decyzję w sprawie oferty',
  meeting: 'Czego dotyczy spotkanie? (opcjonalnie) np. Prezentacja produktu u klienta',
  email: 'Jaki e-mail wysłać? (opcjonalnie) np. Wysłać cennik i warunki dostawy',
};

/** Domyślny termin: najbliższa pełna godzina. */
function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return toLocalInput(d);
}

const invalidateAll = (qc: ReturnType<typeof useQueryClient>, clientId: number) => Promise.all([
  qc.invalidateQueries({ queryKey: ['activities', clientId] }),
  qc.invalidateQueries({ queryKey: ['tasks'] }),
  qc.invalidateQueries({ queryKey: ['clients'] }),
]);

const TYPE_META: Record<ActivityType, { label: string; icon: typeof Phone; tone: string }> = {
  comment: { label: 'komentarz', icon: MessageSquare, tone: 'bg-slate-100 text-slate-600' },
  call: { label: 'telefon', icon: Phone, tone: 'bg-emerald-50 text-emerald-600' },
  meeting: { label: 'spotkanie', icon: Users, tone: 'bg-violet-50 text-violet-600' },
  email: { label: 'e-mail', icon: Mail, tone: 'bg-sky-50 text-sky-600' },
  status_change: { label: 'status', icon: ArrowRightLeft, tone: 'bg-brand-50 text-brand-600' },
  system: { label: 'system', icon: Info, tone: 'bg-slate-100 text-slate-500' },
};

export function ActivityFeed({ clientId, ownerId, readOnly }: { clientId: number; ownerId: number | null; readOnly?: boolean }) {
  const { data: activities = [] } = useQuery({
    queryKey: ['activities', clientId],
    queryFn: () => api.get<Activity[]>(`/api/clients/${clientId}/activities`),
  });
  const { data: me } = useMe();
  // Kolejność z Ustawień użytkownika: domyślnie najnowsze na początku (pole nowego wpisu nad historią);
  // rosnąco – najstarsze na górze, pole nowego wpisu na dole (jak w Asanie). API zwraca od najnowszych.
  const newestFirst = me?.settings.historyOrder !== 'asc';
  const ordered = newestFirst ? activities : [...activities].reverse();

  return (
    <div>
      {!readOnly && newestFirst && <Composer clientId={clientId} ownerId={ownerId} atTop />}
      <div className="space-y-4">
        {ordered.map((a) => <ActivityItem key={a.id} activity={a} readOnly={readOnly} />)}
      </div>
      {!readOnly && !newestFirst && <Composer clientId={clientId} ownerId={ownerId} />}
    </div>
  );
}

function ActivityItem({ activity: a, readOnly }: { activity: Activity; readOnly?: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const meta = TYPE_META[a.type];
  // Autor spoza listy użytkowników (np. „Poprzedni opiekun” z importu).
  const author = a.authorName ?? a.authorLabel;

  // Wpis o założeniu klienta (z aplikacji lub z importu Asany: autor i data z created_by / created_at).
  if (a.type === 'system' && a.content.startsWith('Utworzono klienta')) {
    return (
      <div className="flex items-center gap-2 pl-1 text-xs text-slate-500" title={fmtDateTime(a.createdAt)}>
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${meta.tone}`}><meta.icon size={12} /></span>
        <span>Klient założony przez <b className="font-medium text-slate-600">{author === 'Poprzedni opiekun' ? 'Poprzedniego opiekuna' : author ?? 'nieznanego autora'}</b> w dniu <b className="font-medium text-slate-600">{fmtDay(a.createdAt)}</b></span>
        {a.source === 'asana' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">z Asany</span>}
      </div>
    );
  }

  if (a.type === 'status_change' || a.type === 'system') {
    return (
      <div className="flex items-center gap-2 pl-1 text-xs text-slate-500">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${meta.tone}`}><meta.icon size={12} /></span>
        <span><b className="font-medium text-slate-600">{author ?? 'System'}</b> · {a.content}</span>
        <span className="text-slate-400" title={fmtDateTime(a.createdAt)}>{fmtDay(a.createdAt)}</span>
      </div>
    );
  }

  async function remove() {
    if (!confirm(a.task ? 'Usunąć wpis wraz z zaplanowanym zadaniem?' : 'Usunąć wpis wraz z załącznikami?')) return;
    await api.del(`/api/activities/${a.id}`);
    await invalidateAll(qc, a.clientId);
  }

  // Zadanie może odhaczyć osoba przypisana albo każdy z prawem edycji klienta.
  const canToggle = a.task && (!readOnly || a.task.assigneeId === me?.id);
  async function toggleTask() {
    if (!a.task || !canToggle) return;
    await api.put(`/api/tasks/${a.task.id}`, { done: !a.task.done });
    await invalidateAll(qc, a.clientId);
  }

  const images = a.attachments.filter((f) => /^image\/(jpeg|png|gif|webp)$/.test(f.mimeType));
  const files = a.attachments.filter((f) => !images.includes(f));

  return (
    <div className="group flex gap-3">
      <Avatar name={author} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className={`font-medium ${a.authorName ? '' : 'text-slate-500'}`}>{author ?? 'Użytkownik usunięty'}</span>
          {a.source === 'asana' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500" title="Wpis zaimportowany z Asany">z Asany</span>}
          {a.type !== 'comment' && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.tone}`}><meta.icon size={11} />{meta.label}</span>
          )}
          <span className="text-xs text-slate-400" title={fmtDateTime(a.createdAt)}>{fmtDay(a.createdAt)}</span>
          {!readOnly && (a.authorId === me?.id || me?.role === 'ADMIN') && (
            <button onClick={remove} className="ml-auto text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title="Usuń wpis">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {a.content && <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm ${a.task?.done ? 'text-slate-500' : 'text-slate-700'}`}>{a.content}</p>}
        {a.task && (
          <div className={`mt-1.5 inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${a.task.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : isOverdue(a.task.dueAt) ? 'border-red-200 bg-red-50 text-red-700' : 'border-brand-100 bg-brand-50 text-brand-700'}`}>
            <button onClick={toggleTask} disabled={!canToggle} title={a.task.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}
              className={`flex h-4 w-4 items-center justify-center rounded-full border-2 transition ${a.task.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-400 bg-white text-transparent enabled:hover:border-emerald-500 enabled:hover:text-emerald-500'} disabled:cursor-not-allowed`}>
              <Check size={10} strokeWidth={3} />
            </button>
            <CalendarClock size={12} />
            <span className="font-medium">{a.task.done ? 'Wykonane' : 'Termin'}: {fmtDue(a.task.dueAt)}</span>
            {a.task.assigneeName && <span>· {a.task.assigneeName}</span>}
          </div>
        )}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((f) => (
              <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer">
                <img src={`/api/attachments/${f.id}`} alt={f.fileName} className="h-28 max-w-[220px] rounded-lg border border-slate-200 object-cover hover:opacity-90" />
              </a>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((f) => (
              <a key={f.id} href={`/api/attachments/${f.id}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-500">
                <FileText size={18} className={f.mimeType === 'application/pdf' ? 'text-red-500' : 'text-brand-600'} />
                <span className="max-w-[180px] truncate">{f.fileName}</span>
                <span className="text-xs text-slate-400">{fmtSize(f.size)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ clientId, ownerId, atTop }: { clientId: number; ownerId: number | null; atTop?: boolean }) {
  const { data: me } = useMe();
  const { data: users = [] } = useUsers();
  const qc = useQueryClient();
  const [type, setType] = useState<ActivityType>('comment');
  const [content, setContent] = useState('');
  const [dueAt, setDueAt] = useState(nextHour);
  const [assigneeId, setAssigneeId] = useState('');
  // Kierownik/admin planuje domyślnie dla opiekuna klienta (handlowca), a nie dla siebie.
  const owner = users.find((u) => u.id === ownerId && u.active);
  const selectedAssignee = assigneeId || String(owner?.id ?? me?.id ?? '');
  const planned = PLANNED.has(type);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const duePast = planned && isPastInput(dueAt);
  // Kontakt planowany: wystarczy poprawny termin (opis opcjonalny). Komentarz: treść lub plik.
  const canSubmit = planned ? Boolean(dueAt) && !duePast : Boolean(content.trim() || files.length);

  const addFiles = (list: FileList | File[]) => setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('type', type);
    fd.append('content', content);
    if (planned) {
      fd.append('dueAt', new Date(dueAt).toISOString());
      if (seesAll(me) && selectedAssignee) fd.append('assigneeId', selectedAssignee);
    }
    files.forEach((f) => fd.append('files', f));
    try {
      await api.post(`/api/clients/${clientId}/activities`, fd);
      setContent('');
      setFiles([]);
      setType('comment');
      setDueAt(nextHour());
      setAssigneeId('');
      await invalidateAll(qc, clientId);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div className={atTop ? 'mb-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4' : 'sticky bottom-0 -mx-5 mt-5 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur'}>
      <div className="flex gap-3">
        <Avatar name={me?.fullName} size={32} />
        <div className={`min-w-0 flex-1 rounded-xl border bg-white transition ${dragging ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100'}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <div className="flex gap-1 border-b border-slate-100 px-2 pt-2 pb-1.5">
            {TYPES.map(({ type: t, label, icon: Icon }) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${type === t ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} onPaste={onPaste} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }}
            placeholder={PLACEHOLDERS[type]}
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-400" />
          {planned && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <CalendarClock size={14} className="text-brand-600" /> Kiedy:
                <input type="datetime-local" value={dueAt} min={toLocalInput(new Date())} onChange={(e) => setDueAt(e.target.value)}
                  className={`input w-auto px-2 py-1 text-xs ${duePast ? 'border-red-400 ring-2 ring-red-100' : ''}`} />
              </label>
              {seesAll(me) && (
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  Kto:
                  <select value={selectedAssignee} onChange={(e) => setAssigneeId(e.target.value)} className="input w-auto px-2 py-1 text-xs">
                    {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </select>
                </label>
              )}
              {!dueAt && <span className="text-xs text-red-600">Wybierz datę i godzinę</span>}
              {duePast && <span className="text-xs text-red-600">Termin nie może być w przeszłości</span>}
            </div>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs">
                  <Paperclip size={11} /> <span className="max-w-[140px] truncate">{f.name}</span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between px-2 pb-2">
            <button type="button" onClick={() => fileInput.current?.click()} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Dołącz zdjęcie lub PDF">
              <Paperclip size={16} />
            </button>
            <input ref={fileInput} type="file" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            <Button onClick={submit} disabled={busy || !canSubmit} className="px-3 py-1.5">
              {planned ? <CalendarClock size={14} /> : <Send size={14} />}
              {busy ? 'Zapisywanie…' : planned ? 'Zaplanuj' : 'Dodaj'}
            </Button>
          </div>
        </div>
      </div>
      {error ? <div className="mt-2"><ErrorText error={error} /></div> : null}
    </div>
  );
}
