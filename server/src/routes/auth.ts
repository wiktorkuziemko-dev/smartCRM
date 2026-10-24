import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { createSession, destroySession, requireAuth, trackActivity } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import { getServiceAccount } from '../lib/google.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ login: z.string().trim().min(1), password: z.string().min(1) }), req.body, reply);
    if (!body) return;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.login, body.login.toLowerCase()));
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Nieprawidłowy login lub hasło' });
    }
    await createSession(reply, user.id);
    await trackActivity(user.id, user.lastSeenAt, true);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const [u] = await db.select({ googleCalendarId: schema.users.googleCalendarId, settings: schema.users.settings })
      .from(schema.users).where(eq(schema.users.id, req.user.id));
    const account = await getServiceAccount();
    return {
      ...req.user,
      settings: u?.settings ?? {},
      googleCalendarId: u?.googleCalendarId ?? null,
      googleEnabled: Boolean(account),
      googleServiceEmail: account?.client_email ?? null,
    };
  });

  /** Ustawienia osobiste (np. kolumny listy klientów widoczne domyślnie). */
  app.put('/api/me/settings', { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(z.object({
      clientColumns: z.array(z.string().max(80)).max(100).optional(),
    }), req.body, reply);
    if (!body) return;
    const [u] = await db.select({ settings: schema.users.settings }).from(schema.users).where(eq(schema.users.id, req.user.id));
    const settings = { ...(u?.settings ?? {}), ...body };
    await db.update(schema.users).set({ settings }).where(eq(schema.users.id, req.user.id));
    return settings;
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(z.object({ current: z.string(), next: z.string().min(8, 'Min. 8 znaków') }), req.body, reply);
    if (!body) return;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user.id));
    if (!(await bcrypt.compare(body.current, user.passwordHash))) {
      return reply.code(400).send({ error: 'Obecne hasło jest nieprawidłowe' });
    }
    await db.update(schema.users).set({ passwordHash: await bcrypt.hash(body.next, 10) }).where(eq(schema.users.id, user.id));
    return { ok: true };
  });
}
