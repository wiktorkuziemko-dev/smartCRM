import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Columns3, Copy, KeyRound } from 'lucide-react';
import { api, type Me } from '../lib/api';
import { clientColumnsOf, DEFAULT_CLIENT_COLUMNS, ROLE_LABELS, useFields, useMe } from '../lib/queries';
import { buildColumns } from './Clients';
import { Avatar, Button, ErrorText, Field } from '../components/ui';

export function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-4">
        <Avatar name={me.fullName} size={56} />
        <div>
          <h1 className="text-2xl font-semibold">Ustawienia</h1>
          <p className="text-sm text-slate-500">{me.fullName} · {me.login} · {ROLE_LABELS[me.role]}</p>
        </div>
      </div>
      <ColumnsSection me={me} />
      <CalendarSection me={me} />
      <PasswordSection />
    </div>
  );
}

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><span className="text-brand-600">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function Saved({ text }: { text: string }) {
  return text ? <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Check size={15} /> {text}</span> : null;
}

function ColumnsSection({ me }: { me: Me }) {
  const { data: fields = [] } = useFields();
  const qc = useQueryClient();
  const columns = buildColumns([], [], fields, [], []).filter((c) => c.id !== 'name');
  const [selected, setSelected] = useState<string[]>(clientColumnsOf(me));
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function save(next: string[]) {
    setError(null);
    try {
      const settings = await api.put<Me['settings']>('/api/me/settings', { clientColumns: next });
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, settings } : old));
      setSelected(next);
      setSaved('Zapisano');
      setTimeout(() => setSaved(''), 2500);
    } catch (err) { setError(err); }
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Card icon={<Columns3 size={18} />} title="Kolumny na liście klientów">
      <p className="mb-3 text-sm text-slate-500">
        Wybierz kolumny widoczne po otwarciu listy klientów. Kolumna „Nazwa” jest zawsze widoczna.
        Na liście możesz je też tymczasowo zmienić przyciskiem „Kolumny”.
      </p>
      <div className="grid gap-1 sm:grid-cols-2">
        {columns.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>
      <ErrorText error={error} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => save(['name', ...selected.filter((x) => x !== 'name')])}>Zapisz</Button>
        <Button variant="ghost" onClick={() => save(DEFAULT_CLIENT_COLUMNS)}>Przywróć domyślne</Button>
        <Saved text={saved} />
      </div>
    </Card>
  );
}

function CalendarSection({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(me.googleCalendarId ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  async function save(calendar: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.put<{ calendarId: string | null; syncedTasks?: number }>('/api/me/google-calendar', { calendar });
      qc.setQueryData<Me>(['me'], (old) => (old ? { ...old, googleCalendarId: res.calendarId } : old));
      setValue(res.calendarId ?? '');
      setSaved(res.calendarId ? `Połączono${res.syncedTasks ? ` – wysyłam ${res.syncedTasks} zaplanowanych zadań` : ''}` : 'Odłączono');
      setTimeout(() => setSaved(''), 4000);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(me.googleServiceEmail ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* brak dostępu do schowka */ }
  }

  return (
    <Card icon={<CalendarDays size={18} />} title="Kalendarz Google">
      {!me.googleEnabled ? (
        <p className="text-sm text-slate-500">
          Administrator nie skonfigurował jeszcze integracji z Kalendarzem Google (Administracja → Integracje).
          Do tego czasu przy każdym zadaniu możesz użyć przycisku „Dodaj do Kalendarza Google”.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Twoje zadania (telefony, spotkania, e-maile) będą same pojawiać się w Twoim Kalendarzu Google,
            z przypomnieniem 15 minut przed terminem, i aktualizować się przy każdej zmianie.
          </p>
          <ol className="list-decimal space-y-1.5 rounded-xl bg-slate-50 py-3 pl-8 pr-4 text-sm text-slate-600">
            <li>Otwórz <a className="text-brand-600 hover:underline" href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">ustawienia Kalendarza Google</a> i po lewej wybierz swój kalendarz.</li>
            <li>
              W sekcji <b>„Udostępnij określonym osobom”</b> dodaj adres:
              <span className="mt-1 flex items-center gap-2">
                <code className="break-all rounded bg-white px-2 py-1 text-xs text-slate-800 ring-1 ring-slate-200">{me.googleServiceEmail}</code>
                <button onClick={copy} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><Copy size={12} />{copied ? 'Skopiowano' : 'Kopiuj'}</button>
              </span>
              z uprawnieniem <b>„Wprowadzanie zmian w wydarzeniach”</b>.
            </li>
            <li>W sekcji <b>„Integracja kalendarza”</b> skopiuj <b>Identyfikator kalendarza</b> (dla głównego kalendarza to Twój adres Gmail) i wklej go poniżej. Może to być też adres iCal albo link do kalendarza.</li>
          </ol>
          <Field label="ID lub link do kalendarza">
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="np. jan.kowalski@gmail.com" />
          </Field>
          <ErrorText error={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => save(value)} disabled={busy || !value.trim()}>{busy ? 'Sprawdzam połączenie…' : 'Zapisz i sprawdź'}</Button>
            {me.googleCalendarId && <Button variant="ghost" onClick={() => save(null)} disabled={busy}>Odłącz kalendarz</Button>}
            <Saved text={saved} />
          </div>
          {me.googleCalendarId && !saved && (
            <p className="text-xs text-slate-500">Połączony kalendarz: <b>{me.googleCalendarId}</b></p>
          )}
        </div>
      )}
    </Card>
  );
}

function PasswordSection() {
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function change() {
    setError(null);
    if (pw.next !== pw.repeat) return setError(new Error('Nowe hasła nie są identyczne'));
    try {
      await api.post('/api/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', repeat: '' });
      setSaved('Hasło zostało zmienione');
      setTimeout(() => setSaved(''), 4000);
    } catch (err) { setError(err); }
  }

  return (
    <Card icon={<KeyRound size={18} />} title="Zmiana hasła">
      <div className="space-y-3">
        <Field label="Obecne hasło"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nowe hasło (min. 8 znaków)"><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Powtórz nowe hasło"><input className="input" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
        </div>
        <ErrorText error={error} />
        <div className="flex items-center gap-2">
          <Button onClick={change} disabled={!pw.current || pw.next.length < 8}>Zmień hasło</Button>
          <Saved text={saved} />
        </div>
      </div>
    </Card>
  );
}
