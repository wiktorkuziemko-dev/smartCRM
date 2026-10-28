import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileJson, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useStatuses } from '../lib/queries';
import { Button, ErrorText, Field, TagChip } from '../components/ui';

interface ImportReport {
  tasksInFile: number; newClients: number; existingClients: number; newComments: number; commentsByPreviousOwner: number; authorsUpdated?: number;
  archived: number; tasksCreated: number; voivodeshipsSet: number; clientsWithoutOwner: number;
  skipped: { subtasks: number; completed: number; duplicates: string[] };
  owners: Record<string, number>; unknownPeople: Record<string, number>; newTags: string[];
  preview: { name: string; owner: string; tags: string[]; voivodeship: string | null; email: string | null; phone: string | null; comments: number; task: string | null; archived: boolean }[];
}

const DEFAULTS = { completed: 'archive', dueTasks: 'future', statusId: null as number | null, extractContacts: true, duplicateNames: 'skip' };

/** Administracja → Import: klienci i historia kontaktów z eksportu JSON Asany (najpierw próba, potem import). */
export function ImportTab() {
  const qc = useQueryClient();
  const { data: statuses = [] } = useStatuses();
  const { data: status } = useQuery({ queryKey: ['import-status'], queryFn: () => api.get<{ importedClients: number }>('/api/admin/import/status') });
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState(DEFAULTS);
  const [result, setResult] = useState<{ dryRun: boolean; report: ImportReport } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function send(dryRun: boolean) {
    if (!file) return;
    if (!dryRun && !confirm('Zaimportować dane do SmartCRM? Przed importem zalecana jest kopia zapasowa (backup.ps1).')) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('options', JSON.stringify(options));
    fd.append('dryRun', String(dryRun));
    fd.append('file', file);
    try {
      setResult(await api.post('/api/admin/import/asana', fd));
      if (!dryRun) await Promise.all(['clients', 'tags', 'import-status', 'dashboard', 'tasks', 'archive'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (err) { setError(err); setResult(null); } finally { setBusy(false); }
  }

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: (typeof DEFAULTS)[K]) => { setOptions((o) => ({ ...o, [k]: v })); setResult(null); };
  const r = result?.report;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><FileJson size={18} className="text-brand-600" /> Import z Asany (JSON)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Taski stają się klientami, projekty – tagami, komentarze – historią kontaktów (z oryginalną datą i autorem).
          Opiekunem zostaje osoba przypisana w Asanie, jeśli ma w SmartCRM konto z tym samym adresem e-mail – inaczej klienta widzą tylko admin i kierownik.
          Wpisy osób spoza SmartCRM są podpisane ich imieniem i nazwiskiem z Asany. Ponowny import dodaje tylko nowych klientów i nowe komentarze
          oraz uzupełnia autorów we wpisach zaimportowanych wcześniej.
          {status ? ` Zaimportowano dotąd klientów: ${status.importedClients}.` : ''}
        </p>

        <label className="mb-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500 hover:border-brand-500 hover:text-brand-600">
          <Upload size={18} /> {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) – kliknij, aby zmienić` : 'Wybierz plik JSON wyeksportowany z Asany'}
          <input type="file" accept=".json,application/json" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }} />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status w lejku dla importowanych klientów">
            <select className="input" value={options.statusId ?? ''} onChange={(e) => set('statusId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">— brak statusu —</option>
              {statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Zakończone taski (completed)">
            <select className="input" value={options.completed} onChange={(e) => set('completed', e.target.value)}>
              <option value="archive">Importuj do Archiwum</option>
              <option value="import">Importuj jako zwykłych klientów</option>
              <option value="skip">Pomiń</option>
            </select>
          </Field>
          <Field label="Termin taska (due_on) → zadanie dla opiekuna">
            <select className="input" value={options.dueTasks} onChange={(e) => set('dueTasks', e.target.value)}>
              <option value="future">Tylko terminy od dziś (godz. 9:00)</option>
              <option value="all">Wszystkie, także zaległe</option>
              <option value="none">Nie twórz zadań</option>
            </select>
          </Field>
          <Field label="Klient o tej samej nazwie już istnieje w SmartCRM">
            <select className="input" value={options.duplicateNames} onChange={(e) => set('duplicateNames', e.target.value)}>
              <option value="skip">Pomiń (pokaż w raporcie)</option>
              <option value="import">Importuj mimo to</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={options.extractContacts} onChange={(e) => set('extractContacts', e.target.checked)} />
            Uzupełnij e-mail i telefon klienta pierwszym adresem i numerem znalezionym w opisie (cały opis i tak trafia do pola „Krótki opis”)
          </label>
        </div>

        <ErrorText error={error} />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(true)} disabled={!file || busy}>{busy ? 'Przetwarzam…' : '1. Sprawdź (próba, bez zapisu)'}</Button>
          <Button onClick={() => send(false)} disabled={!file || busy || !result?.dryRun}>2. Importuj</Button>
        </div>
        {!result && file && <p className="mt-2 text-xs text-slate-400">Import jest dostępny po wykonaniu próby z bieżącymi opcjami.</p>}
      </section>

      {r && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className={`mb-3 flex items-center gap-2 font-semibold ${result!.dryRun ? '' : 'text-emerald-700'}`}>
            {result!.dryRun ? <><AlertTriangle size={18} className="text-amber-500" /> Wynik próby – nic nie zostało zapisane</> : <><CheckCircle2 size={18} /> Import zakończony</>}
          </h2>
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            {[
              ['Tasków w pliku', r.tasksInFile], ['Nowi klienci', r.newClients], ['Już w SmartCRM', r.existingClients],
              ['Nowe komentarze', r.newComments], ['Do Archiwum', r.archived], ['Bez opiekuna', r.clientsWithoutOwner],
              ['Zadania z terminów', r.tasksCreated], ['Z województwem', r.voivodeshipsSet],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-lg font-semibold">{value}</div><div className="text-xs text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 text-sm lg:grid-cols-2">
            <div>
              <h3 className="mb-1 font-medium">Opiekunowie</h3>
              {Object.keys(r.owners).length
                ? <ul className="space-y-0.5 text-slate-600">{Object.entries(r.owners).map(([n, c]) => <li key={n}>{n}: <b>{c}</b> klientów</li>)}</ul>
                : <p className="text-slate-400">Żaden opiekun nie został rozpoznany.</p>}
              <h3 className="mt-3 mb-1 font-medium">Nowe tagi (z projektów)</h3>
              <div className="flex flex-wrap gap-1">{r.newTags.length ? r.newTags.map((t) => <TagChip key={t} name={t} color="#64748b" />) : <span className="text-slate-400">brak</span>}</div>
            </div>
            <div>
              <h3 className="mb-1 font-medium">Osoby spoza SmartCRM (podpisane imieniem i nazwiskiem z Asany)</h3>
              <p className="mb-1 text-xs text-slate-500">Jeśli ktoś z tej listy nadal pracuje, dodaj mu w Użytkownikach ten sam e-mail i powtórz próbę.</p>
              {Object.keys(r.unknownPeople).length
                ? <ul className="space-y-0.5 text-slate-600">{Object.entries(r.unknownPeople).map(([e, c]) => <li key={e}>{e} <span className="text-slate-400">({c} wpisów)</span></li>)}</ul>
                : <p className="text-slate-400">Wszyscy autorzy rozpoznani.</p>}
              <p className="mt-1 text-xs text-slate-500">Nowych komentarzy autorów spoza SmartCRM: {r.commentsByPreviousOwner}{r.authorsUpdated ? ` · uzupełniono autora we wcześniejszych wpisach: ${r.authorsUpdated}` : ''}</p>
            </div>
          </div>

          {(r.skipped.subtasks > 0 || r.skipped.completed > 0 || r.skipped.duplicates.length > 0) && (
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Pominięte: podzadania {r.skipped.subtasks}, zakończone {r.skipped.completed}, duplikaty nazw {r.skipped.duplicates.length}
              {r.skipped.duplicates.length > 0 && <div className="mt-1 text-xs">Duplikaty: {r.skipped.duplicates.slice(0, 30).join(', ')}{r.skipped.duplicates.length > 30 ? ' …' : ''}</div>}
            </div>
          )}

          {r.preview.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <h3 className="mb-1 text-sm font-medium">Podgląd pierwszych klientów</h3>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr><th className="px-2 py-1.5">Nazwa</th><th className="px-2">Opiekun</th><th className="px-2">Tagi</th><th className="px-2">Woj.</th><th className="px-2">Telefon</th><th className="px-2">E-mail</th><th className="px-2">Kom.</th><th className="px-2">Zadanie</th></tr>
                </thead>
                <tbody>
                  {r.preview.map((p) => (
                    <tr key={p.name} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-medium">{p.name}{p.archived && <span className="ml-1 text-slate-400">(archiwum)</span>}</td>
                      <td className="px-2">{p.owner}</td><td className="px-2">{p.tags.join(', ')}</td><td className="px-2">{p.voivodeship ?? '—'}</td>
                      <td className="px-2">{p.phone ?? '—'}</td><td className="px-2">{p.email ?? '—'}</td><td className="px-2">{p.comments}</td><td className="px-2">{p.task ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
