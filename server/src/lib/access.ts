import { and, eq, exists, or, type SQL } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { db, schema } from '../db/index.js';
import { seesAllClients, type SessionUser } from './auth.js';

/**
 * Warunek SQL: klienci widoczni dla użytkownika.
 * Kierownik i admin widzą wszystkich. Handlowiec widzi klientów, którymi się opiekuje,
 * klientów wskazanych mu przez admina oraz klientów z tagami, do których admin dał mu dostęp.
 */
export function clientVisibleTo(user: SessionUser): SQL | undefined {
  if (seesAllClients(user)) return undefined;
  return or(
    eq(schema.clients.ownerId, user.id),
    exists(db.select().from(schema.clientAccess).where(and(
      eq(schema.clientAccess.clientId, schema.clients.id),
      eq(schema.clientAccess.userId, user.id),
    ))),
    exists(db.select().from(schema.clientTags)
      .innerJoin(schema.tagAccess, eq(schema.tagAccess.tagId, schema.clientTags.tagId))
      .where(and(
        eq(schema.clientTags.clientId, schema.clients.id),
        eq(schema.tagAccess.userId, user.id),
      ))),
  );
}

/** Zwraca klienta, jeśli użytkownik ma do niego dostęp; w przeciwnym razie wysyła 404/403. */
export async function loadClientFor(user: SessionUser, clientId: number, reply: FastifyReply) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) {
    reply.code(404).send({ error: 'Nie znaleziono klienta' });
    return null;
  }
  if (!seesAllClients(user)) {
    const [visible] = await db.select({ id: schema.clients.id }).from(schema.clients)
      .where(and(eq(schema.clients.id, clientId), clientVisibleTo(user)));
    if (!visible) {
      reply.code(403).send({ error: 'Brak dostępu do tego klienta' });
      return null;
    }
  }
  return client;
}

export async function touchClient(clientId: number) {
  await db.update(schema.clients).set({ updatedAt: new Date() }).where(eq(schema.clients.id, clientId));
}
