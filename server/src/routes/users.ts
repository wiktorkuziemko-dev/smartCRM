import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { idParam, optionalText, parse } from '../lib/validate.js';

const roles = z.enum(['ADMIN', 'MANAGER', 'SALES']);

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Lista użytkowników – wszyscy widzą podstawowe dane (do przypisywania), admin widzi więcej.
  app.get('/api/users', async (req) => {
    const rows = await db.select().from(schema.users).orderBy(asc(schema.users.fullName));
    return rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      active: u.active,
      ...(req.user.role === 'ADMIN' ? { login: u.login, email: u.email, googleConnected: Boolean(u.googleRefreshToken) } : {}),
    }));
  });

  app.post('/api/users', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = parse(z.object({
      login: z.string().trim().toLowerCase().min(2).max(64).regex(/^[a-z0-9._-]+$/, 'Dozwolone: a-z, 0-9, . _ -'),
      fullName: z.string().trim().min(1).max(128),
      email: optionalText(255),
      role: roles,
      password: z.string().min(8, 'Min. 8 znaków'),
    }), req.body, reply);
    if (!body) return;
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.login, body.login));
    if (exists) return reply.code(409).send({ error: 'Taki login już istnieje' });
    const { password, ...rest } = body;
    const [user] = await db.insert(schema.users)
      .values({ ...rest, passwordHash: await bcrypt.hash(password, 10) })
      .returning({ id: schema.users.id });
    return user;
  });

  app.put('/api/users/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(z.object({
      fullName: z.string().trim().min(1).max(128).optional(),
      email: optionalText(255).optional(),
      role: roles.optional(),
      active: z.boolean().optional(),
      password: z.string().min(8, 'Min. 8 znaków').optional(),
    }), req.body, reply);
    if (!params || !body) return;
    if (params.id === req.user.id && (body.role && body.role !== 'ADMIN' || body.active === false)) {
      return reply.code(400).send({ error: 'Nie możesz odebrać sobie uprawnień administratora' });
    }
    const { password, ...rest } = body;
    await db.update(schema.users)
      .set({ ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) })
      .where(eq(schema.users.id, params.id));
    if (body.active === false || password) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, params.id));
    }
    return { ok: true };
  });
}
