import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { SESSION_COOKIE } from './auth.js';

/**
 * Dziennik zdarzeń dla administratora. Zapis odbywa się automatycznie dla każdej zmiany danych
 * (POST/PUT/DELETE w /api) oraz wybranych odczytów (karta klienta, załącznik, raport, eksport).
 * Przed zmianą zapamiętujemy stan rekordu, po zmianie porównujemy – w logu jest „było → jest”.
 * Nazwy (użytkownika, klienta) zapisujemy w chwili zdarzenia, więc log jest czytelny także po usunięciu danych.
 */

export type AuditCategory = 'auth' | 'client' | 'history' | 'task' | 'access' | 'users' | 'settings' | 'integration' | 'import' | 'export' | 'view';

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  auth: 'Logowanie', client: 'Klienci', history: 'Historia kontaktów', task: 'Zadania', access: 'Dostęp do klientów',
  users: 'Użytkownicy', settings: 'Konfiguracja', integration: 'Integracje', import: 'Import', export: 'Eksport', view: 'Podgląd danych',
};

type Entity = 'client' | 'task' | 'contact' | 'activity' | 'user' | 'status' | 'tag' | 'field' | 'access';
interface ActionDef { category: AuditCategory; label: string; entity?: Entity }

const ACTIONS: Record<string, ActionDef> = {
  'POST /api/auth/login': { category: 'auth', label: 'Logowanie' },
  'POST /api/auth/logout': { category: 'auth', label: 'Wylogowanie' },
  'POST /api/auth/password': { category: 'auth', label: 'Zmiana własnego hasła' },
  'PUT /api/me/settings': { category: 'settings', label: 'Zmiana ustawień osobistych' },
  'PUT /api/me/google-calendar': { category: 'integration', label: 'Zmiana kalendarza Google' },

  'POST /api/clients': { category: 'client', label: 'Dodanie klienta', entity: 'client' },
  'PUT /api/clients/:id': { category: 'client', label: 'Edycja klienta', entity: 'client' },
  'DELETE /api/clients/:id': { category: 'client', label: 'Archiwizacja klienta', entity: 'client' },
  'POST /api/clients/:id/restore': { category: 'client', label: 'Przywrócenie klienta z archiwum', entity: 'client' },
  'DELETE /api/clients/:id/permanent': { category: 'client', label: 'Trwałe usunięcie klienta', entity: 'client' },
  'POST /api/clients/:id/contacts': { category: 'client', label: 'Dodanie osoby kontaktowej', entity: 'client' },
  'PUT /api/contacts/:id': { category: 'client', label: 'Edycja osoby kontaktowej', entity: 'contact' },
  'DELETE /api/contacts/:id': { category: 'client', label: 'Usunięcie osoby kontaktowej', entity: 'contact' },
  'PUT /api/clients/:id/access/:userId': { category: 'access', label: 'Zmiana dostępu handlowca', entity: 'access' },

  'POST /api/clients/:id/activities': { category: 'history', label: 'Wpis w historii', entity: 'client' },
  'DELETE /api/activities/:id': { category: 'history', label: 'Usunięcie wpisu z historii', entity: 'activity' },

  'POST /api/tasks': { category: 'task', label: 'Dodanie zadania', entity: 'task' },
  'PUT /api/tasks/:id': { category: 'task', label: 'Zmiana zadania', entity: 'task' },
  'DELETE /api/tasks/:id': { category: 'task', label: 'Usunięcie zadania', entity: 'task' },

  'POST /api/users': { category: 'users', label: 'Dodanie użytkownika', entity: 'user' },
  'PUT /api/users/:id': { category: 'users', label: 'Edycja użytkownika', entity: 'user' },
  'PUT /api/users/:id/avatar': { category: 'users', label: 'Zmiana zdjęcia profilowego', entity: 'user' },
  'DELETE /api/users/:id/avatar': { category: 'users', label: 'Usunięcie zdjęcia profilowego', entity: 'user' },

  'POST /api/statuses': { category: 'settings', label: 'Dodanie statusu', entity: 'status' },
  'PUT /api/statuses/:id': { category: 'settings', label: 'Edycja statusu', entity: 'status' },
  'DELETE /api/statuses/:id': { category: 'settings', label: 'Usunięcie statusu', entity: 'status' },
  'PUT /api/statuses-order': { category: 'settings', label: 'Zmiana kolejności statusów' },
  'POST /api/tags': { category: 'settings', label: 'Dodanie tagu', entity: 'tag' },
  'PUT /api/tags/:id': { category: 'settings', label: 'Edycja tagu', entity: 'tag' },
  'DELETE /api/tags/:id': { category: 'settings', label: 'Usunięcie tagu', entity: 'tag' },
  'PUT /api/tags-order': { category: 'settings', label: 'Zmiana kolejności tagów' },
  'POST /api/fields': { category: 'settings', label: 'Dodanie pola klienta', entity: 'field' },
  'PUT /api/fields/:id': { category: 'settings', label: 'Edycja pola klienta', entity: 'field' },
  'DELETE /api/fields/:id': { category: 'settings', label: 'Usunięcie pola klienta', entity: 'field' },
  'PUT /api/fields-order': { category: 'settings', label: 'Zmiana kolejności pól klienta' },

  'PUT /api/admin/google': { category: 'integration', label: 'Konfiguracja Kalendarza Google' },
  'DELETE /api/admin/google': { category: 'integration', label: 'Wyłączenie Kalendarza Google' },
  'PUT /api/admin/eserver': { category: 'integration', label: 'Konfiguracja E-SERVER' },
  'DELETE /api/admin/eserver': { category: 'integration', label: 'Wyłączenie E-SERVER' },
  'PUT /api/admin/eserver/assign': { category: 'integration', label: 'Przypisanie nadajnika GPS', entity: 'user' },
  'POST /api/admin/import/asana': { category: 'import', label: 'Import z Asany' },

  'POST /api/audit/export': { category: 'export', label: 'Eksport do Excela' },
  // Odczyty, które warto znać (kto przeglądał jakie dane).
  'GET /api/clients/:id': { category: 'view', label: 'Otwarcie karty klienta', entity: 'client' },
  'GET /api/attachments/:id': { category: 'view', label: 'Pobranie załącznika' },
  'GET /api/reports/:key': { category: 'view', label: 'Raport' },
};

// Pola, których nigdy nie zapisujemy (hasła, klucze, obrazki).
const SECRET = /pass|secret|private|token|key$|^json$|dataUrl|md5/i;

interface AuditState {
  def: ActionDef;
  clientId?: number | null;
  clientName?: string | null;
  before?: Record<string, unknown> | null;
  target?: string | null;
  payload?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auditState?: AuditState;
  }
}

/** Dopisanie informacji przez obsługę zapytania (np. rodzaj wpisu w historii). */
export function auditNote(req: FastifyRequest, info: { summary?: string; details?: Record<string, unknown>; clientId?: number }) {
  if (!req.auditState) return;
  if (info.summary) req.auditState.summary = info.summary;
  if (info.details) req.auditState.details = { ...req.auditState.details, ...info.details };
  if (info.clientId) req.auditState.clientId = info.clientId;
}

const recentViews = new Map<string, number>();

export function registerAudit(app: FastifyInstance) {
  // Przed obsługą: rozpoznanie akcji i stan rekordu „przed”.
  app.addHook('preHandler', async (req) => {
    const route = req.routeOptions.url;
    if (!route?.startsWith('/api/')) return;
    const def = ACTIONS[`${req.method} ${route}`];
    if (!def) return;
    const params = (req.params ?? {}) as Record<string, string>;
    const state: AuditState = { def };
    try {
      const snap = await snapshot(def.entity, params, req.body as Record<string, unknown> | undefined);
      Object.assign(state, snap);
      if (def.label === 'Wylogowanie') {
        const u = await sessionUserOf(req);
        state.target = u ? `${u.id}|${u.fullName}` : null;
      }
    } catch { /* log nie może blokować pracy */ }
    req.auditState = state;
  });

  app.addHook('onSend', async (req, _reply, payload) => {
    if (req.auditState && typeof payload === 'string' && payload.length < 50_000 && req.method !== 'GET') req.auditState.payload = payload;
    return payload;
  });

  app.addHook('onResponse', async (req, reply) => {
    const state = req.auditState;
    if (!state) return;
    const status = reply.statusCode;
    const isLogin = state.def.label === 'Logowanie';
    // Zapisujemy udane operacje, nieudane logowania i próby bez uprawnień.
    if (status >= 400 && !(isLogin && status === 401) && status !== 403) return;
    try {
      await write(req, state, status);
    } catch (err) {
      req.log.warn({ err }, 'Nie udało się zapisać zdarzenia w dzienniku');
    }
  });
}

async function write(req: FastifyRequest, state: AuditState, status: number) {
  const { def } = state;
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
  const params = (req.params ?? {}) as Record<string, string>;
  let userId: number | null = req.user?.id ?? null;
  let userName: string | null = req.user?.fullName ?? null;
  let action = def.label;
  let summary = state.summary ?? '';
  const details: Record<string, unknown> = { ...state.details };
  let clientId = state.clientId ?? null;
  let clientName = state.clientName ?? null;

  if (def.label === 'Logowanie') {
    const login = String(body.login ?? '').toLowerCase();
    const [u] = await db.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.login, login));
    userId = u?.id ?? null;
    userName = u?.fullName ?? login;
    if (status !== 200) { action = 'Nieudane logowanie'; summary = `Login: ${login}`; }
  } else if (def.label === 'Wylogowanie') {
    if (!state.target) return; // brak sesji – nic do zapisania
    userId = Number(state.target.split('|')[0]); userName = state.target.split('|')[1];
  }
  if (status === 403) action = `${action} – odmowa (brak uprawnień)`;

  // Odczyty: karta klienta liczona raz na 10 min dla tej samej osoby.
  if (def.category === 'view') {
    if (def.label === 'Otwarcie karty klienta') {
      const key = `${userId}:${params.id}`;
      const last = recentViews.get(key) ?? 0;
      if (Date.now() - last < 10 * 60_000) return;
      recentViews.set(key, Date.now());
    } else if (def.label === 'Pobranie załącznika') {
      const [a] = await db.select({ fileName: schema.attachments.fileName, clientId: schema.activities.clientId, clientName: schema.clients.name })
        .from(schema.attachments).innerJoin(schema.activities, eq(schema.activities.id, schema.attachments.activityId))
        .innerJoin(schema.clients, eq(schema.clients.id, schema.activities.clientId)).where(eq(schema.attachments.id, Number(params.id)));
      if (a) { summary = a.fileName; clientId = a.clientId; clientName = a.clientName; }
    } else if (def.label === 'Raport') {
      summary = `${params.key}${Object.keys(req.query as object).length ? ` · ${new URLSearchParams(req.query as Record<string, string>)}` : ''}`;
    }
  }
  if (def.category === 'export') summary = `${String(body.file ?? '')} · ${Number(body.rows ?? 0)} wierszy`;

  // Zmiany „było → jest” dla edycji.
  if (state.before && req.method === 'PUT' && def.entity && def.entity !== 'access') {
    const after = (await snapshot(def.entity, params, body)).before;
    if (after) {
      const changes = await diff(def.entity, state.before, after);
      if (changes.length) details.changes = changes;
      if (!summary) summary = changes.length ? changes.map((c) => c.field).join(', ') : '';
    }
  }
  if (def.entity === 'access' && state.before) {
    details.changes = [{ field: `Dostęp: ${state.before.userName}`, from: state.before.level, to: accessLabel(body.level as string) }];
    summary = `${state.before.userName}: ${state.before.level} → ${accessLabel(body.level as string)}`;
  }
  if (req.method === 'DELETE' && state.target && !summary) summary = state.target;
  if (state.target && req.method === 'PUT' && def.entity !== 'client' && def.entity !== 'access') summary = summary ? `${state.target}: ${summary}` : state.target;
  if (body.password && def.entity === 'user') summary = summary ? `${summary}, nowe hasło` : 'nowe hasło';

  // Dodanie: dane z żądania i id nowego rekordu z odpowiedzi.
  if (req.method === 'POST' && def.category !== 'auth' && def.category !== 'export') {
    const created = parseJson(state.payload);
    if (def.label === 'Dodanie klienta' && created?.id) { clientId = Number(created.id); clientName = String(body.name ?? created.name ?? ''); }
    if (!summary) summary = String(body.name ?? body.title ?? body.fullName ?? body.label ?? '');
    if (def.category === 'import' && created) details.result = created;
  }
  if (def.category !== 'integration' && def.category !== 'auth' && Object.keys(body).length && req.method !== 'GET') {
    details.request = clean(body);
  }

  await db.insert(schema.auditLog).values({
    userId, userName, ip: req.ip, category: def.category, action,
    clientId, clientName, summary: summary.slice(0, 2000), details: Object.keys(details).length ? details : null, status,
  });
}

const parseJson = (s?: string) => { try { return s ? JSON.parse(s) as Record<string, unknown> : null; } catch { return null; } };

/** Usuwa hasła i klucze, skraca długie teksty. */
function clean(v: unknown, depth = 0): unknown {
  if (depth > 3) return '…';
  if (typeof v === 'string') return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
  }
  return v;
}

const accessLabel = (l?: string) => ({ none: 'brak', view: 'podgląd', edit: 'edycja' } as Record<string, string>)[l ?? ''] ?? String(l ?? '—');

/** Stan rekordu (do porównania) oraz klient, którego dotyczy zdarzenie. */
async function snapshot(entity: Entity | undefined, params: Record<string, string>, body?: Record<string, unknown>): Promise<Partial<AuditState>> {
  const id = Number(params.id);
  switch (entity) {
    case 'client': {
      if (!id) return {};
      const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!c) return {};
      const tags = await db.select({ name: schema.tags.name }).from(schema.clientTags)
        .innerJoin(schema.tags, eq(schema.tags.id, schema.clientTags.tagId)).where(eq(schema.clientTags.clientId, id));
      return { clientId: id, clientName: c.name, before: { ...c, tags: tags.map((t) => t.name).sort().join(', ') } };
    }
    case 'task': {
      if (!id) {
        const cid = Number(body?.clientId);
        if (!cid) return {};
        const [c] = await db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, cid));
        return { clientId: cid, clientName: c?.name ?? null };
      }
      const [t] = await db.select({ task: schema.tasks, clientName: schema.clients.name }).from(schema.tasks)
        .leftJoin(schema.clients, eq(schema.clients.id, schema.tasks.clientId)).where(eq(schema.tasks.id, id));
      return t ? { clientId: t.task.clientId, clientName: t.clientName, before: { ...t.task }, target: t.task.title } : {};
    }
    case 'contact': {
      const [k] = await db.select({ contact: schema.contacts, clientName: schema.clients.name }).from(schema.contacts)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.contacts.clientId)).where(eq(schema.contacts.id, id));
      return k ? { clientId: k.contact.clientId, clientName: k.clientName, before: { ...k.contact }, target: k.contact.name } : {};
    }
    case 'activity': {
      const [a] = await db.select({ activity: schema.activities, clientName: schema.clients.name }).from(schema.activities)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.activities.clientId)).where(eq(schema.activities.id, id));
      return a ? { clientId: a.activity.clientId, clientName: a.clientName, target: `${a.activity.type}: ${a.activity.content.slice(0, 200)}` } : {};
    }
    case 'access': {
      const userId = Number(params.userId);
      const [c] = await db.select({ name: schema.clients.name, ownerId: schema.clients.ownerId }).from(schema.clients).where(eq(schema.clients.id, id));
      const [u] = await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, userId));
      const [row] = await db.select({ level: schema.clientAccess.level }).from(schema.clientAccess)
        .where(and(eq(schema.clientAccess.clientId, id), eq(schema.clientAccess.userId, userId)));
      const level = row?.level ?? (c?.ownerId === userId ? 'edit' : 'none');
      return c ? { clientId: id, clientName: c.name, before: { userName: u?.fullName ?? `#${userId}`, level: accessLabel(level) } } : {};
    }
    case 'user': {
      const uid = id || Number(body?.userId);
      if (!uid) return {};
      const [u] = await db.select({ fullName: schema.users.fullName, email: schema.users.email, role: schema.users.role, active: schema.users.active, gpsSerial: schema.users.gpsSerial })
        .from(schema.users).where(eq(schema.users.id, uid));
      return u ? { before: { ...u }, target: u.fullName } : {};
    }
    case 'status': case 'tag': case 'field': {
      if (!id) return {};
      const table = entity === 'status' ? schema.clientStatuses : entity === 'tag' ? schema.tags : schema.customFields;
      const [row] = await db.select().from(table).where(eq(table.id, id));
      if (!row) return {};
      return { before: { ...row }, target: 'label' in row ? row.label : row.name };
    }
    default:
      return {};
  }
}

const LABELS: Record<string, string> = {
  name: 'Nazwa', nip: 'NIP', voivodeship: 'Województwo', email: 'E-mail', phone: 'Telefon', potential: 'Potencjał',
  currentSolution: 'Aktualne rozwiązanie', description: 'Opis', statusId: 'Status', ownerId: 'Opiekun', tags: 'Tagi',
  title: 'Tytuł', type: 'Rodzaj', notes: 'Notatki', dueAt: 'Termin', done: 'Wykonane', assigneeId: 'Wykonawca',
  position: 'Stanowisko / kolejność', isPrimary: 'Główna osoba', fullName: 'Imię i nazwisko', role: 'Rola', active: 'Aktywny',
  gpsSerial: 'Nadajnik GPS', color: 'Kolor', label: 'Nazwa pola', options: 'Opcje', showInList: 'Na liście',
};
const SKIP = new Set(['updatedAt', 'createdAt', 'id', 'custom', 'googleEventId', 'archivedAt', 'archivedById', 'createdById', 'externalId', 'clientId', 'key', 'createdBy']);

/** Lista zmienionych pól z czytelnymi wartościami (nazwy statusów i osób zamiast numerów). */
async function diff(entity: Entity, before: Record<string, unknown>, after: Record<string, unknown>) {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined || v === '' ? null : v);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !SKIP.has(k));
  const userIds = new Set<number>();
  const statusIds = new Set<number>();
  for (const k of keys) {
    if (JSON.stringify(norm(before[k])) === JSON.stringify(norm(after[k]))) continue;
    changes.push({ field: k, from: norm(before[k]), to: norm(after[k]) });
    if (k === 'ownerId' || k === 'assigneeId') for (const v of [before[k], after[k]]) if (v) userIds.add(Number(v));
    if (k === 'statusId') for (const v of [before[k], after[k]]) if (v) statusIds.add(Number(v));
  }
  // Pola dodatkowe klienta (custom) – porównanie po kluczu z etykietą pola.
  if (entity === 'client') {
    const b = (before.custom ?? {}) as Record<string, unknown>;
    const a = (after.custom ?? {}) as Record<string, unknown>;
    const fields = await db.select({ key: schema.customFields.key, label: schema.customFields.label }).from(schema.customFields);
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (JSON.stringify(norm(b[k])) !== JSON.stringify(norm(a[k]))) changes.push({ field: fields.find((f) => f.key === k)?.label ?? k, from: norm(b[k]), to: norm(a[k]) });
    }
  }
  const users = userIds.size ? await db.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, [...userIds])) : [];
  const statuses = statusIds.size ? await db.select({ id: schema.clientStatuses.id, name: schema.clientStatuses.name }).from(schema.clientStatuses).where(inArray(schema.clientStatuses.id, [...statusIds])) : [];
  const show = (k: string, v: unknown) => {
    if (v == null) return '—';
    if (k === 'ownerId' || k === 'assigneeId') return users.find((u) => u.id === Number(v))?.fullName ?? `#${v}`;
    if (k === 'statusId') return statuses.find((s) => s.id === Number(v))?.name ?? `#${v}`;
    if (typeof v === 'boolean') return v ? 'tak' : 'nie';
    if (typeof v === 'string' && v.length > 300) return `${v.slice(0, 300)}…`;
    return typeof v === 'object' ? JSON.stringify(v) : v;
  };
  return changes.map((c) => ({ field: LABELS[c.field] ?? c.field, from: show(c.field, c.from), to: show(c.field, c.to) }));
}

/** Użytkownik bieżącej sesji (dla wylogowania – sesja znika w trakcie obsługi). */
export async function sessionUserOf(req: FastifyRequest) {
  const id = req.cookies[SESSION_COOKIE];
  if (!id) return null;
  const [row] = await db.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId)).where(eq(schema.sessions.id, id));
  return row ?? null;
}
