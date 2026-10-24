import { and, eq, exists, inArray, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { db, schema } from '../db/index.js';
import { seesAllClients, type SessionUser } from './auth.js';
import type { AccessLevel } from '../db/schema.js';

/**
 * Zasady dostępu handlowca do klienta (jedyne miejsce zarządzania: karta klienta, admin lub kierownik):
 * 1. Jeśli admin/kierownik ustawił dostęp tego handlowca do klienta (client_access) – obowiązuje on
 *    (brak / podgląd / edycja), także dla opiekuna.
 * 2. W przeciwnym razie opiekun ma pełną edycję, a pozostali handlowcy nie widzą klienta.
 * Kierownik i admin mają pełny dostęp do wszystkich klientów. Tagi nie wpływają na dostęp.
 */
function directRule(userId: number, levels?: AccessLevel[]) {
  return exists(db.select().from(schema.clientAccess).where(and(
    eq(schema.clientAccess.clientId, schema.clients.id),
    eq(schema.clientAccess.userId, userId),
    levels ? inArray(schema.clientAccess.level, levels) : undefined,
  )));
}

function accessCondition(user: SessionUser, levels: AccessLevel[]): SQL {
  return or(
    directRule(user.id, levels),
    and(not(directRule(user.id)), eq(schema.clients.ownerId, user.id)),
  )!;
}

/** Warunek SQL: klienci, których użytkownik może oglądać (zarchiwizowani są ukryci dla wszystkich). */
export function clientVisibleTo(user: SessionUser): SQL {
  const active = isNull(schema.clients.archivedAt);
  if (seesAllClients(user)) return active;
  return and(active, accessCondition(user, ['view', 'edit']))!;
}

/** Wyrażenie SQL (boolean): czy użytkownik może edytować klienta z bieżącego wiersza. */
export function clientEditableBy(user: SessionUser): SQL<boolean> {
  if (seesAllClients(user)) return sql<boolean>`true`;
  return sql<boolean>`(${accessCondition(user, ['edit'])})`;
}

/**
 * Zwraca klienta, jeśli użytkownik ma do niego wymagany dostęp; w przeciwnym razie wysyła 404/403.
 * need = 'view' do odczytu, 'edit' do zmian (dane, kontakty, historia, zadania).
 */
export async function loadClientFor(user: SessionUser, clientId: number, reply: FastifyReply, need: 'view' | 'edit' = 'view') {
  const [row] = await db.select({
    client: schema.clients,
    visible: sql<boolean>`(${clientVisibleTo(user)})`,
    canEdit: clientEditableBy(user),
  }).from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!row) {
    reply.code(404).send({ error: 'Nie znaleziono klienta' });
    return null;
  }
  // Zarchiwizowanego klienta może tylko podejrzeć admin (w archiwum); nikt go nie edytuje.
  if (row.client.archivedAt) {
    if (user.role === 'ADMIN' && need === 'view') return { ...row.client, canEdit: false };
    reply.code(404).send({ error: 'Klient został zarchiwizowany' });
    return null;
  }
  if (!row.visible) {
    reply.code(403).send({ error: 'Brak dostępu do tego klienta' });
    return null;
  }
  if (need === 'edit' && !row.canEdit) {
    reply.code(403).send({ error: 'Masz dostęp do tego klienta tylko do podglądu' });
    return null;
  }
  return { ...row.client, canEdit: row.canEdit };
}

export async function touchClient(clientId: number) {
  await db.update(schema.clients).set({ updatedAt: new Date() }).where(eq(schema.clients.id, clientId));
}
