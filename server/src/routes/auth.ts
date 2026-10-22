import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { createSession, destroySession, requireAuth } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import { googleEnabled } from '../config.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(z.object({ login: z.string().trim().min(1), password: z.string().min(1) }), req.body, reply);
    if (!body) return;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.login, body.login.toLowerCase()));
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Nieprawidłowy login lub hasło' });
    }
    await createSession(reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const [u] = await db.select({ googleCalendarEmail: schema.users.googleCalendarEmail })
      .from(schema.users).where(eq(schema.users.id, req.user.id));
    return { ...req.user, googleCalendarEmail: u?.googleCalendarEmail ?? null, googleEnabled: googleEnabled() };
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
