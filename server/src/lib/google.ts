import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db, schema } from '../db/index.js';

/**
 * Synchronizacja zadań z Kalendarzem Google przez konto usługi (service account).
 *
 * Admin raz wgrywa klucz konta usługi (JSON z Google Cloud). Każdy użytkownik udostępnia swój
 * kalendarz e-mailowi konta usługi z uprawnieniem „Wprowadzanie zmian w wydarzeniach” i podaje
 * w Ustawieniach ID (albo link) kalendarza. Serwer łączy się z Google tylko w kierunku wychodzącym,
 * więc działa w sieci lokalnej bez domeny i bez logowania użytkowników do Google.
 */

const SETTINGS_KEY = 'google_service_account';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TYPE_PREFIX = { task: '', call: '📞 Telefon: ', meeting: '🤝 Spotkanie: ', email: '✉️ E-mail: ' } as const;

interface ServiceAccount { client_email: string; private_key: string; token_uri: string }

let cachedAccount: ServiceAccount | null | undefined;
let cachedToken: { token: string; expires: number } | null = null;

export async function getServiceAccount(): Promise<ServiceAccount | null> {
  if (cachedAccount !== undefined) return cachedAccount;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  cachedAccount = (row?.value as ServiceAccount | undefined) ?? null;
  return cachedAccount;
}

export async function googleEnabled() {
  return Boolean(await getServiceAccount());
}

/** Sprawdza i zapisuje klucz konta usługi (zawartość pliku JSON z Google Cloud). */
export async function saveServiceAccount(json: string) {
  let parsed: Partial<ServiceAccount & { type: string }>;
  try { parsed = JSON.parse(json); } catch { throw new Error('To nie jest poprawny plik JSON.'); }
  if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
    throw new Error('To nie jest klucz konta usługi Google (brak pól type=service_account, client_email lub private_key).');
  }
  const account: ServiceAccount = {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
  };
  await fetchAccessToken(account); // rzuca błąd, jeśli Google odrzuci klucz
  await db.insert(schema.appSettings).values({ key: SETTINGS_KEY, value: account })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: account } });
  cachedAccount = account;
  cachedToken = null;
  return account.client_email;
}

export async function removeServiceAccount() {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY));
  cachedAccount = null;
  cachedToken = null;
}

const base64url = (data: string | Buffer) => Buffer.from(data).toString('base64url');

/** Token dostępu OAuth 2.0 dla konta usługi (JWT podpisany kluczem prywatnym, RS256). */
async function fetchAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: now, exp: now + 3600 }));
  let signature: string;
  try {
    signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key, 'base64url');
  } catch {
    throw new Error('Nieprawidłowy klucz prywatny w pliku JSON.');
  }
  const res = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Google odrzucił klucz konta usługi: ${body.error_description ?? body.error ?? res.status}`);
  }
  return { token: body.access_token, expires: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000 };
}

async function accessToken() {
  const account = await getServiceAccount();
  if (!account) throw new Error('Integracja z Kalendarzem Google nie jest skonfigurowana');
  if (!cachedToken || cachedToken.expires < Date.now()) cachedToken = await fetchAccessToken(account);
  return cachedToken.token;
}

async function calendarFetch(calendarId: string, path: string, init: RequestInit = {}) {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
  });
}

/**
 * Z linku do kalendarza (adres iCal, link do osadzenia, link z ustawień) albo z samego ID
 * wyciąga ID kalendarza, np. "jan.kowalski@gmail.com" lub "abc123@group.calendar.google.com".
 */
export function parseCalendarId(input: string) {
  const text = input.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const src = url.searchParams.get('src') ?? url.searchParams.get('cid');
      if (src) return src.includes('@') ? src : Buffer.from(src, 'base64').toString('utf8');
      const ical = url.pathname.match(/\/calendar\/ical\/([^/]+)\//);
      if (ical) return decodeURIComponent(ical[1]);
    } catch { /* niżej: nieprawidłowy link */ }
    return null;
  }
  const id = decodeURIComponent(text);
  return /^[^\s@]+@[^\s@]+$/.test(id) ? id : null;
}

/** Sprawdza, czy konto usługi może dodawać wydarzenia do kalendarza (tworzy i od razu usuwa próbne). */
export async function verifyCalendarAccess(calendarId: string) {
  const start = new Date(Date.now() + 365 * 864e5);
  const res = await calendarFetch(calendarId, '', {
    method: 'POST',
    body: JSON.stringify({
      summary: 'SmartCRM – test połączenia',
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 60_000).toISOString() },
      reminders: { useDefault: false, overrides: [] },
    }),
  });
  if (!res.ok) {
    if (res.status === 404 || res.status === 403) {
      throw new Error('Brak dostępu do kalendarza. Sprawdź, czy kalendarz jest udostępniony kontu usługi z uprawnieniem „Wprowadzanie zmian w wydarzeniach” i czy ID jest poprawne.');
    }
    throw new Error(`Google zwrócił błąd ${res.status}: ${await res.text()}`);
  }
  const created = (await res.json()) as { id: string };
  await calendarFetch(calendarId, `/${created.id}`, { method: 'DELETE' });
}

/**
 * Tworzy, aktualizuje lub usuwa wydarzenie w kalendarzu osoby przypisanej do zadania.
 * Zadanie wykonane lub usunięte => wydarzenie jest usuwane. Błędy są tylko logowane.
 */
export async function syncTaskToGoogle(taskId: number, opts: { deleted?: boolean; previousAssigneeId?: number } = {}) {
  if (!(await googleEnabled())) return;
  try {
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    if (!task) return;

    // Zmiana osoby przypisanej – usuń wydarzenie z kalendarza poprzedniej osoby.
    if (opts.previousAssigneeId && opts.previousAssigneeId !== task.assigneeId && task.googleEventId) {
      await removeEvent(opts.previousAssigneeId, task.googleEventId);
      await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.id, taskId));
      task.googleEventId = null;
    }

    if (opts.deleted || task.done) {
      if (task.googleEventId) {
        await removeEvent(task.assigneeId, task.googleEventId);
        if (!opts.deleted) await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.id, taskId));
      }
      return;
    }

    const [assignee] = await db.select().from(schema.users).where(eq(schema.users.id, task.assigneeId));
    if (!assignee?.googleCalendarId) return;

    let clientName = '';
    if (task.clientId) {
      const [c] = await db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, task.clientId));
      clientName = c?.name ?? '';
    }
    const start = task.dueAt;
    const end = new Date(start.getTime() + 30 * 60_000);
    const body = JSON.stringify({
      summary: `${TYPE_PREFIX[task.type]}${clientName ? `${task.title} – ${clientName}` : task.title}`,
      description: [task.notes, task.clientId ? `${config.appUrl}/clients/${task.clientId}` : ''].filter(Boolean).join('\n\n'),
      start: { dateTime: start.toISOString(), timeZone: config.timezone },
      end: { dateTime: end.toISOString(), timeZone: config.timezone },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
    });

    if (task.googleEventId) {
      const res = await calendarFetch(assignee.googleCalendarId, `/${task.googleEventId}`, { method: 'PATCH', body });
      if (res.ok) return;
      if (res.status !== 404 && res.status !== 410) throw new Error(`PATCH ${res.status}: ${await res.text()}`);
      // Wydarzenie usunięte ręcznie w Google – utwórz ponownie.
    }
    const res = await calendarFetch(assignee.googleCalendarId, '', { method: 'POST', body });
    if (!res.ok) throw new Error(`POST ${res.status}: ${await res.text()}`);
    const created = (await res.json()) as { id: string };
    await db.update(schema.tasks).set({ googleEventId: created.id }).where(eq(schema.tasks.id, taskId));
  } catch (err) {
    console.error(`Synchronizacja zadania ${taskId} z Google nie powiodła się:`, err);
  }
}

async function removeEvent(userId: number, eventId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.googleCalendarId) return;
  const res = await calendarFetch(user.googleCalendarId, `/${eventId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error(`Nie udało się usunąć wydarzenia Google ${eventId}: ${res.status}`);
  }
}
