import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, FileText, Info, Mail, MessageSquare, Paperclip, Phone, Send, Trash2, Users, X } from 'lucide-react';
import { api, type Activity, type ActivityType } from '../lib/api';
import { fmtAgo, fmtDateTime, fmtSize } from '../lib/format';
import { useMe } from '../lib/queries';
import { Avatar, Button, ErrorText } from './ui';

const TYPES: { type: ActivityType; label: string; icon: typeof Phone }[] = [
  { type: 'comment', label: 'Komentarz', icon: MessageSquare },
  { type: 'call', label: 'Telefon', icon: Phone },
  { type: 'meeting', label: 'Spotkanie', icon: Users },
  { type: 'email', label: 'E-mail', icon: Mail },
];
const TYPE_META: Record<ActivityType, { label: string; icon: typeof Phone; tone: string }> = {
  comment: { label: 'komentarz', icon: MessageSquare, tone: 'bg-slate-100 text-slate-600' },
  call: { label: 'telefon', icon: Phone, tone: 'bg-emerald-50 text-emerald-600' },
  meeting: { label: 'spotkanie', icon: Users, tone: 'bg-violet-50 text-violet-600' },
  email: { label: 'e-mail', icon: Mail, tone: 'bg-sky-50 text-sky-600' },
  status_change: { label: 'status', icon: ArrowRightLeft, tone: 'bg-brand-50 text-brand-600' },
  system: { label: 'system', icon: Info, tone: 'bg-slate-100 text-slate-500' },
};

export function ActivityFeed({ clientId, readOnly }: { clientId: number; readOnly?: boolean }) {
  const { data: activities = [] } = useQuery({
    queryKey: ['activities', clientId],
    queryFn: () => api.get<Activity[]>(`/api/clients/${clientId}/activities`),
  });
  // Najstarsze na górze, kompozytor na dole – jak w Asanie.
  const ordered = [...activities].reverse();

  return (
    <div>
      <div className="space-y-4">
        {ordered.map((a) => <ActivityItem key={a.id} activity={a} readOnly={readOnly} />)}
      </div>
      {!readOnly && <Composer clientId={clientId} />}
    </div>
  );
}

function ActivityItem({ activity: a, readOnly }: { activity: Activity; readOnly?: boolean }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const meta = TYPE_META[a.type];

  if (a.type === 'status_change' || a.type === 'system') {
    return (
      <div className="flex items-center gap-2 pl-1 text-xs text-slate-500">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full ${meta.tone}`}><meta.icon size={12} /></span>
        <span><b className="font-medium text-slate-600">{a.authorName ?? 'System'}</b> · {a.content}</span>
        <span className="text-slate-400" title={fmtDateTime(a.createdAt)}>{fmtAgo(a.createdAt)}</span>
      </div>
    );
  }

  async function remove() {
    if (!confirm('Usunąć wpis wraz z załącznikami?')) return;
    await api.del(`/api/activities/${a.id}`);
    qc.invalidateQueries({ queryKey: ['activities', a.clientId] });
  }

  const images = a.attachments.filter((f) => /^image\/(jpeg|png|gif|webp)$/.test(f.mimeType));
  const files = a.attachments.filter((f) => !images.includes(f));

  return (
    <div className="group flex gap-3">
      <Avatar name={a.authorName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{a.authorName ?? 'Użytkownik usunięty'}</span>
          {a.type !== 'comment' && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${meta.tone}`}><meta.icon size={11} />{meta.label}</span>
          )}
          <span className="text-xs text-slate-400" title={fmtDateTime(a.createdAt)}>{fmtAgo(a.createdAt)}</span>
          {!readOnly && (a.authorId === me?.id || me?.role === 'ADMIN') && (
            <button onClick={remove} className="ml-auto text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100" title="Usuń wpis">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {a.content && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{a.content}</p>}
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

function Composer({ clientId }: { clientId: number }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [type, setType] = useState<ActivityType>('comment');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => setFiles((f) => [...f, ...Array.from(list)].slice(0, 10));

  async function submit() {
    if (!content.trim() && !files.length) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('type', type);
    fd.append('content', content);
    files.forEach((f) => fd.append('files', f));
    try {
      await api.post(`/api/clients/${clientId}/activities`, fd);
      setContent('');
      setFiles([]);
      setType('comment');
      await qc.invalidateQueries({ queryKey: ['activities', clientId] });
      qc.invalidateQueries({ queryKey: ['clients'] });
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
    <div className="sticky bottom-0 -mx-5 mt-5 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
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
            placeholder="Dodaj notatkę z rozmowy, komentarz… (Ctrl+Enter wysyła, możesz wkleić lub przeciągnąć plik)"
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-400" />
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
            <Button onClick={submit} disabled={busy || (!content.trim() && !files.length)} className="px-3 py-1.5">
              <Send size={14} /> {busy ? 'Wysyłanie…' : 'Dodaj'}
            </Button>
          </div>
        </div>
      </div>
      {error ? <div className="mt-2"><ErrorText error={error} /></div> : null}
    </div>
  );
}
