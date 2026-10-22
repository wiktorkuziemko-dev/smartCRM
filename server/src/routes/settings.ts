import type { FastifyInstance } from 'fastify';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { idParam, parse } from '../lib/validate.js';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const fieldBody = z.object({
  label: z.string().trim().min(1).max(128),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  options: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  showInList: z.boolean().default(true),
  active: z.boolean().default(true),
});

/** Zamienia etykietę na klucz techniczny, np. "Liczba oddziałów" -> "liczba_oddzialow". */
function slugify(label: string) {
  return label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'pole';
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const adminOnly = { preHandler: requireRole('ADMIN') };

  // --- Statusy klienta (lejek) ---
  app.get('/api/statuses', async () =>
    db.select().from(schema.clientStatuses).orderBy(asc(schema.clientStatuses.position), asc(schema.clientStatuses.id)));

  app.post('/api/statuses', adminOnly, async (req, reply) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(64), color }), req.body, reply);
    if (!body) return;
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.clientStatuses.position}), -1)` }).from(schema.clientStatuses);
    const [row] = await db.insert(schema.clientStatuses).values({ ...body, position: Number(max) + 1 }).returning();
    return row;
  });

  app.put('/api/statuses/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(z.object({
      name: z.string().trim().min(1).max(64).optional(),
      color: color.optional(),
      active: z.boolean().optional(),
    }), req.body, reply);
    if (!params || !body) return;
    await db.update(schema.clientStatuses).set(body).where(eq(schema.clientStatuses.id, params.id));
    return { ok: true };
  });

  app.put('/api/statuses-order', adminOnly, async (req, reply) => {
    const body = parse(z.object({ ids: z.array(z.number().int()) }), req.body, reply);
    if (!body) return;
    await db.transaction(async (tx) => {
      for (const [position, id] of body.ids.entries()) {
        await tx.update(schema.clientStatuses).set({ position }).where(eq(schema.clientStatuses.id, id));
      }
    });
    return { ok: true };
  });

  app.delete('/api/statuses/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const [{ used }] = await db.select({ used: sql<number>`count(*)` }).from(schema.clients)
      .where(eq(schema.clients.statusId, params.id));
    if (Number(used) > 0) {
      return reply.code(409).send({ error: `Status jest używany przez ${used} klientów – możesz go dezaktywować.` });
    }
    await db.delete(schema.clientStatuses).where(eq(schema.clientStatuses.id, params.id));
    return { ok: true };
  });

  // --- Tagi klientów ---
  // Wszyscy widzą listę tagów; admin dodatkowo widzi, którzy handlowcy mają dostęp do klientów z tagiem.
  app.get('/api/tags', async (req) => {
    const tags = await db.select().from(schema.tags).orderBy(asc(schema.tags.position), asc(schema.tags.id));
    if (req.user.role !== 'ADMIN') return tags;
    const access = await db.select().from(schema.tagAccess);
    return tags.map((t) => ({
      ...t,
      access: access.filter((a) => a.tagId === t.id).map(({ userId, level }) => ({ userId, level })),
    }));
  });

  const tagBody = z.object({
    name: z.string().trim().toLowerCase().min(1).max(64),
    color,
    // Handlowcy z dostępem do klientów z tym tagiem: podgląd lub pełna edycja.
    access: z.array(z.object({ userId: z.number().int(), level: z.enum(['view', 'edit']) })).max(200).default([]),
  });

  async function setTagAccess(tagId: number, access: { userId: number; level: 'view' | 'edit' }[]) {
    const unique = [...new Map(access.map((a) => [a.userId, a])).values()];
    await db.transaction(async (tx) => {
      await tx.delete(schema.tagAccess).where(eq(schema.tagAccess.tagId, tagId));
      if (unique.length) await tx.insert(schema.tagAccess).values(unique.map((a) => ({ tagId, ...a })));
    });
  }

  app.post('/api/tags', adminOnly, async (req, reply) => {
    const body = parse(tagBody, req.body, reply);
    if (!body) return;
    const [exists] = await db.select().from(schema.tags).where(eq(schema.tags.name, body.name));
    if (exists) return reply.code(409).send({ error: 'Taki tag już istnieje' });
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.tags.position}), -1)` }).from(schema.tags);
    const [row] = await db.insert(schema.tags).values({ name: body.name, color: body.color, position: Number(max) + 1 }).returning();
    await setTagAccess(row.id, body.access);
    return row;
  });

  app.put('/api/tags/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(tagBody.partial(), req.body, reply);
    if (!params || !body) return;
    const { access, ...data } = body;
    if (data.name) {
      const [dup] = await db.select().from(schema.tags).where(eq(schema.tags.name, data.name));
      if (dup && dup.id !== params.id) return reply.code(409).send({ error: 'Taki tag już istnieje' });
    }
    if (Object.keys(data).length) await db.update(schema.tags).set(data).where(eq(schema.tags.id, params.id));
    if (access) await setTagAccess(params.id, access);
    return { ok: true };
  });

  app.put('/api/tags-order', adminOnly, async (req, reply) => {
    const body = parse(z.object({ ids: z.array(z.number().int()) }), req.body, reply);
    if (!body) return;
    await db.transaction(async (tx) => {
      for (const [position, id] of body.ids.entries()) {
        await tx.update(schema.tags).set({ position }).where(eq(schema.tags.id, id));
      }
    });
    return { ok: true };
  });

  app.delete('/api/tags/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    await db.delete(schema.tags).where(eq(schema.tags.id, params.id));
    return { ok: true };
  });

  // --- Pola dodatkowe klienta ---
  app.get('/api/fields', async () =>
    db.select().from(schema.customFields).orderBy(asc(schema.customFields.position), asc(schema.customFields.id)));

  app.post('/api/fields', adminOnly, async (req, reply) => {
    const body = parse(fieldBody, req.body, reply);
    if (!body) return;
    const existing = await db.select({ key: schema.customFields.key }).from(schema.customFields);
    const taken = new Set(existing.map((f) => f.key));
    let key = slugify(body.label);
    for (let i = 2; taken.has(key); i++) key = `${slugify(body.label)}_${i}`;
    const [row] = await db.insert(schema.customFields).values({ ...body, key, position: existing.length }).returning();
    return row;
  });

  app.put('/api/fields/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(fieldBody.partial(), req.body, reply);
    if (!params || !body) return;
    await db.update(schema.customFields).set(body).where(eq(schema.customFields.id, params.id));
    return { ok: true };
  });

  app.put('/api/fields-order', adminOnly, async (req, reply) => {
    const body = parse(z.object({ ids: z.array(z.number().int()) }), req.body, reply);
    if (!body) return;
    await db.transaction(async (tx) => {
      for (const [position, id] of body.ids.entries()) {
        await tx.update(schema.customFields).set({ position }).where(eq(schema.customFields.id, id));
      }
    });
    return { ok: true };
  });

  app.delete('/api/fields/:id', adminOnly, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    // Wartości w klientach zostają w JSON (nie giną), ale przestają być widoczne.
    await db.delete(schema.customFields).where(eq(schema.customFields.id, params.id));
    return { ok: true };
  });
}
