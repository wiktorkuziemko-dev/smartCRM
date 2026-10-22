import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, ErrorText } from '../components/ui';

export function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { login, password });
      qc.clear();
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-brand-gradient flex min-h-screen items-center justify-center p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[28rem] w-[28rem] rounded-full bg-sky-300/20 blur-3xl" />
      </div>
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl shadow-blue-900/30">
        <div className="mb-6 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-2xl font-bold text-slate-800">SmartCRM</h1>
          <p className="text-sm text-slate-500">Zaloguj się, aby kontynuować</p>
        </div>
        <div className="space-y-3">
          <input className="input" placeholder="Login" autoFocus autoComplete="username"
            value={login} onChange={(e) => setLogin(e.target.value)} />
          <input className="input" placeholder="Hasło" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <ErrorText error={error} />
          <Button type="submit" className="w-full py-2.5" disabled={busy || !login || !password}>
            {busy ? 'Logowanie…' : 'Zaloguj się'}
          </Button>
        </div>
      </form>
    </div>
  );
}
