import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { db, schema } from '../db/index.js';
import { seesAllClients, type SessionUser } from './auth.js';

/** Zwraca klienta, jeśli użytkownik ma do niego dostęp; w przeciwnym razie wysyła 404/403. */
export async function loadClientFor(user: SessionUser, clientId: number, reply: FastifyReply) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) {
    reply.code(404).send({ error: 'Nie znaleziono klienta' });
    return null;
  }
  if (!seesAllClients(user) && client.ownerId !== user.id) {
    reply.code(403).send({ error: 'Brak dostępu do tego klienta' });
    return null;
  }
  return client;
}

export async function touchClient(clientId: number) {
  await db.update(schema.clients).set({ updatedAt: new Date() }).where(eq(schema.clients.id, clientId));
}
