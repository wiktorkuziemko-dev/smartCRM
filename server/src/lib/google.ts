import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config, googleEnabled } from '../config.js';
import { db, schema } from '../db/index.js';

/**
 * Synchronizacja zadań z Google Calendar (OAuth 2.0, bez dodatkowych bibliotek).
 * Serwer łączy się z Google tylko w kierunku wychodzącym, więc działa także w sieci lokalnej.
 */

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const redirectUri = () => `${config.appUrl}/api/google/callback`;

const TYPE_PREFIX = { task: '', call: '📞 Telefon: ', meeting: '🤝 Spotkanie: ', email: '✉️ E-mail: ' } as const;

// Jednorazowe tokeny "state" chroniące przed CSRF (ważne 10 minut).
const pendingStates = new Map<string, { userId: number; expires: number }>();

export function buildAuthUrl(userId: number) {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { userId, expires: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function consumeState(state: string) {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.userId;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token?: string };
}

export async function connectAccount(userId: number, code: string) {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error('Google nie zwrócił refresh_token');
  const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json() as Promise<{ email?: string }>);
  await db.update(schema.users)
    .set({ googleRefreshToken: tokens.refresh_token, googleCalendarEmail: info.email ?? null })
    .where(eq(schema.users.id, userId));
}

export async function disconnectAccount(userId: number) {
  await db.update(schema.users)
    .set({ googleRefreshToken: null, googleCalendarEmail: null })
    .where(eq(schema.users.id, userId));
}

async function calendarFetch(refreshToken: string, path: string, init: RequestInit = {}) {
  const { access_token } = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
  });
}

/**
 * Tworzy, aktualizuje lub usuwa wydarzenie w kalendarzu osoby przypisanej do zadania.
 * Zadanie wykonane lub usunięte => wydarzenie jest usuwane. Błędy są tylko logowane.
 */
export async function syncTaskToGoogle(taskId: number, opts: { deleted?: boolean; previousAssigneeId?: number } = {}) {
  if (!googleEnabled()) return;
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
    if (!assignee?.googleRefreshToken) return;

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
      source: { title: 'SmartCRM', url: config.appUrl },
    });

    if (task.googleEventId) {
      const res = await calendarFetch(assignee.googleRefreshToken, `/${task.googleEventId}`, { method: 'PATCH', body });
      if (res.ok) return;
      if (res.status !== 404 && res.status !== 410) throw new Error(`PATCH ${res.status}: ${await res.text()}`);
      // Wydarzenie usunięte ręcznie w Google – utwórz ponownie.
    }
    const res = await calendarFetch(assignee.googleRefreshToken, '', { method: 'POST', body });
    if (!res.ok) throw new Error(`POST ${res.status}: ${await res.text()}`);
    const created = (await res.json()) as { id: string };
    await db.update(schema.tasks).set({ googleEventId: created.id }).where(eq(schema.tasks.id, taskId));
  } catch (err) {
    console.error(`Synchronizacja zadania ${taskId} z Google nie powiodła się:`, err);
  }
}

async function removeEvent(userId: number, eventId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.googleRefreshToken) return;
  const res = await calendarFetch(user.googleRefreshToken, `/${eventId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error(`Nie udało się usunąć wydarzenia Google ${eventId}: ${res.status}`);
  }
}
