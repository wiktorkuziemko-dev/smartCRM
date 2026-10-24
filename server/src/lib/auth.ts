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
      lastSeenAt: schema.users.lastSeenAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, id), gt(schema.sessions.expiresAt, new Date())));
  if (!row || !row.active) return reply.code(401).send({ error: 'Sesja wygasła' });
  const { active: _, lastSeenAt, ...user } = row;
  req.user = user;
  void trackActivity(user.id, lastSeenAt);
}

const VISIT_GAP_MS = 30 * 60_000;

/**
 * Aktywność do statystyk: zapis "wejścia" (login_events) przy logowaniu i przy powrocie
 * po co najmniej 30 minutach przerwy; last_seen_at aktualizowane najwyżej raz na minutę.
 */
// Ostatnio zarejestrowana aktywność w pamięci – równoległe zapytania przy otwarciu strony
// nie mogą zapisać kilku "wejść" (sprawdzenie i zapis do mapy są synchroniczne).
const lastSeenCache = new Map<number, number>();

export async function trackActivity(userId: number, lastSeenAt: Date | null, isLogin = false) {
  const now = Date.now();
  const last = Math.max(lastSeenAt?.getTime() ?? 0, lastSeenCache.get(userId) ?? 0);
  if (!isLogin && now - last < 60_000) return;
  lastSeenCache.set(userId, now);
  try {
    if (isLogin || now - last >= VISIT_GAP_MS) await db.insert(schema.loginEvents).values({ userId });
    if (isLogin || now - last >= 60_000) {
      await db.update(schema.users).set({ lastSeenAt: new Date(now) }).where(eq(schema.users.id, userId));
    }
  } catch (err) {
    console.error('Nie udało się zapisać aktywności użytkownika', err);
  }
}

/** preHandler: wymaga jednej z ról (używać po requireAuth). */
export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Brak uprawnień' });
  };
}

/** Kierownik i admin widzą wszystkich klientów; handlowiec tylko swoich. */
export const seesAllClients = (user: SessionUser) => user.role === 'ADMIN' || user.role === 'MANAGER';
