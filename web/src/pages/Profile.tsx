import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check } from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABELS, useMe } from '../lib/queries';
import { Avatar, Button, ErrorText, Field } from '../components/ui';

export function ProfilePage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!me) return null;

  async function changePassword() {
    setError(null); setMsg(null);
    if (pw.next !== pw.repeat) return setError(new Error('Hasła nie są identyczne'));
    try {
      await api.post('/api/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', repeat: '' });
      setMsg('Hasło zostało zmienione.');
    } catch (err) { setError(err); }
  }

  async function disconnect() {
    await api.post('/api/google/disconnect');
    qc.invalidateQueries({ queryKey: ['me'] });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-4">
        <Avatar name={me.fullName} size={56} />
        <div>
          <h1 className="text-2xl font-semibold">{me.fullName}</h1>
          <p className="text-sm text-slate-500">{me.login} · {ROLE_LABELS[me.role]}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><CalendarDays size={18} className="text-brand-600" /> Kalendarz Google</h2>
        {params.get('google') === 'error' && <div className="my-2"><ErrorText error="Nie udało się połączyć z Kalendarzem Google." /></div>}
        {!me.googleEnabled ? (
          <p className="text-sm text-slate-500">
            Automatyczna synchronizacja nie jest skonfigurowana przez administratora. Przy każdym zadaniu możesz użyć przycisku
            „Dodaj do Kalendarza Google”.
          </p>
        ) : me.googleCalendarEmail ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-slate-600"><Check size={15} className="mr-1 inline text-emerald-500" />Połączono z <b>{me.googleCalendarEmail}</b>. Twoje zadania trafiają do kalendarza automatycznie (z przypomnieniem 15 min przed).</p>
            <Button variant="secondary" onClick={disconnect}>Odłącz</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-slate-600">Połącz konto, aby Twoje zadania automatycznie pojawiały się w Kalendarzu Google z przypomnieniem.</p>
            <a href="/api/google/connect"><Button>Połącz z Google</Button></a>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Zmiana hasła</h2>
        <div className="space-y-3">
          <Field label="Obecne hasło"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nowe hasło (min. 8 znaków)"><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="Powtórz nowe hasło"><input className="input" type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
          </div>
          <ErrorText error={error} />
          {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
          <Button onClick={changePassword} disabled={!pw.current || pw.next.length < 8}>Zmień hasło</Button>
        </div>
      </section>
    </div>
  );
}
