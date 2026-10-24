import { api } from './api';

/** Akcje archiwum (tylko admin). Zwracają true, jeśli operacja została wykonana. */
export async function restoreClient(id: number, name: string) {
  if (!confirm(`Przywrócić klienta „${name}” z archiwum? Znów będzie widoczny dla uprawnionych osób.`)) return false;
  await api.post(`/api/clients/${id}/restore`);
  return true;
}

export async function purgeClient(id: number, name: string) {
  const typed = prompt(
    `Trwałe usunięcie klienta „${name}”.\n\n` +
    'Zostaną skasowane wszystkie dane: osoby kontaktowe, historia, załączniki, zadania, tagi i ustawienia dostępu. ' +
    'Tej operacji NIE MOŻNA cofnąć.\n\nAby potwierdzić, wpisz: USUŃ',
  );
  if (typed?.trim().toUpperCase() !== 'USUŃ') return false;
  await api.del(`/api/clients/${id}/permanent`);
  return true;
}
