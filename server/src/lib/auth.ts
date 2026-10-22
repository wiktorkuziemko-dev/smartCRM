import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import type { Role, User } from '../db/schema.js';

export const SESSION_COOKIE = 'smartcrm_session';

export type SessionUser = Pick<User, 'id' | 'login' | 'fullName' | 'email' | 'role'>;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser;
  }
}

export async function createSession(reply: FastifyReply, userId: number) {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionDays * 864e5);
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  reply.setCookie(SESSION_COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const id = req.cookies[SESSION_COOKIE];
  if (id) await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** preHandler: wymaga zalogowanego, aktywnego użytkownika. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const id = req.cookies[SESSION_COOKIE];
  if (!id) return reply.code(401).send({ error: 'Nie zalogowano' });
  const [row] = await db
    .select({
      id: schema.users.id,
      login: schema.users.login,
      fullName: schema.users.fullName,
      email: schema.users.email,
      role: schema.users.role,
      active: schema.users.active,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())));
  if (!row || !row.active) return reply.code(401).send({ error: 'Sesja wygasła' });
  const { active: _, ...user } = row;
  req.user = user;
}

/** preHandler: wymaga jednej z ról (używać po requireAuth). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Brak uprawnień' });
  };
}

/** Kierownik i admin widzą wszystkich klientów; handlowiec tylko swoich. */
export const seesAllClients = (user: SessionUser) => user.role === 'ADMIN' || user.role === 'MANAGER';
