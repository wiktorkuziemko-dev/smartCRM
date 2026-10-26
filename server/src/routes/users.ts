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
      avatarUrl: avatarUrl(u),
      ...(req.user.role === 'ADMIN' ? { login: u.login, email: u.email, googleConnected: Boolean(u.googleCalendarId) } : {}),
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

  // --- Zdjęcie profilowe: admin dla każdego, użytkownik dla siebie. Obraz przycięty i zmniejszony w przeglądarce. ---
  app.get('/api/users/:id/avatar', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const [row] = await db.select().from(schema.userAvatars).where(eq(schema.userAvatars.userId, params.id));
    if (!row) return reply.code(404).send({ error: 'Brak zdjęcia' });
    // Adres zawiera wersję (?v=…), więc obraz można trzymać w pamięci przeglądarki bez ograniczeń.
    return reply.header('Content-Type', row.mimeType).header('Cache-Control', 'private, max-age=31536000, immutable').send(row.data);
  });

  app.put('/api/users/:id/avatar', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(z.object({ dataUrl: z.string().max(2_000_000) }), req.body, reply);
    if (!params || !body) return;
    if (params.id !== req.user.id && req.user.role !== 'ADMIN') return reply.code(403).send({ error: 'Brak uprawnień' });
    const m = body.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return reply.code(400).send({ error: 'Obsługiwane formaty: JPG, PNG, WEBP' });
    const data = Buffer.from(m[2], 'base64');
    if (data.length > 500_000) return reply.code(400).send({ error: 'Zdjęcie jest za duże (maks. 500 KB po zmniejszeniu)' });
    if (!isImage(data)) return reply.code(400).send({ error: 'Plik nie jest obrazem' });
    await db.transaction(async (tx) => {
      await tx.insert(schema.userAvatars).values({ userId: params.id, mimeType: m[1], data })
        .onConflictDoUpdate({ target: schema.userAvatars.userId, set: { mimeType: m[1], data } });
      await tx.update(schema.users).set({ avatarUpdatedAt: new Date() }).where(eq(schema.users.id, params.id));
    });
    return { ok: true };
  });

  app.delete('/api/users/:id/avatar', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    if (params.id !== req.user.id && req.user.role !== 'ADMIN') return reply.code(403).send({ error: 'Brak uprawnień' });
    await db.delete(schema.userAvatars).where(eq(schema.userAvatars.userId, params.id));
    await db.update(schema.users).set({ avatarUpdatedAt: null }).where(eq(schema.users.id, params.id));
    return { ok: true };
  });
}

/** Adres zdjęcia profilowego z wersją (zmienia się po każdej zmianie zdjęcia); null = brak zdjęcia. */
export const avatarUrl = (u: { id: number; avatarUpdatedAt: Date | null }) =>
  (u.avatarUpdatedAt ? `/api/users/${u.id}/avatar?v=${u.avatarUpdatedAt.getTime()}` : null);

/** Sprawdza sygnaturę pliku: JPEG, PNG lub WEBP. */
function isImage(b: Buffer) {
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP');
}
