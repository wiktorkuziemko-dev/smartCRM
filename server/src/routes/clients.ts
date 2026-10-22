import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole, seesAllClients, type SessionUser } from '../lib/auth.js';
import { loadClientFor, touchClient } from '../lib/access.js';
import { idParam, optionalText, parse } from '../lib/validate.js';

export const VOIVODESHIPS = [
  'dolnośląskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie', 'łódzkie', 'małopolskie',
  'mazowieckie', 'opolskie', 'podkarpackie', 'podlaskie', 'pomorskie', 'śląskie',
  'świętokrzyskie', 'warmińsko-mazurskie', 'wielkopolskie', 'zachodniopomorskie',
];

const clientBody = z.object({
  name: z.string().trim().min(1, 'Nazwa jest wymagana').max(255),
  nip: z.string().trim().nullish().transform((v) => (v ? v.replace(/[^0-9]/g, '') : null))
    .refine((v) => v === null || v.length === 10, 'NIP musi mieć 10 cyfr'),
  voivodeship: z.enum(VOIVODESHIPS as [string, ...string[]]).nullish().transform((v) => v ?? null),
  email: optionalText(255).refine((v) => v === null || z.email().safeParse(v).success, 'Niepoprawny e-mail'),
  phone: optionalText(64),
  potential: z.coerce.number().int().min(0).nullish().transform((v) => v ?? null),
  currentSolution: optionalText(),
  description: optionalText(),
  statusId: z.number().int().nullish().transform((v) => v ?? null),
  ownerId: z.number().int().nullish(),
  custom: z.record(z.string(), z.unknown()).default({}),
});

const contactBody = z.object({
  name: z.string().trim().min(1, 'Imię i nazwisko jest wymagane').max(128),
  position: optionalText(128),
  phone: optionalText(64),
  email: optionalText(255).refine((v) => v === null || z.email().safeParse(v).success, 'Niepoprawny e-mail'),
  isPrimary: z.boolean().default(false),
});

/** Zostawia tylko pola zdefiniowane przez admina i rzutuje wartości na właściwe typy. */
async function sanitizeCustom(input: Record<string, unknown>, previous: Record<string, unknown> = {}) {
  const fields = await db.select().from(schema.customFields).where(eq(schema.customFields.active, true));
  const out: Record<string, unknown> = { ...previous };
  for (const f of fields) {
    if (!(f.key in input)) continue;
    const v = input[f.key];
    if (v === null || v === undefined || v === '') { delete out[f.key]; continue; }
    switch (f.type) {
      case 'number': { const n = Number(v); if (Number.isFinite(n)) out[f.key] = n; break; }
      case 'checkbox': out[f.key] = Boolean(v); break;
      case 'date': if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[f.key] = String(v); break;
      case 'select': if (f.options.includes(String(v))) out[f.key] = String(v); break;
      default: out[f.key] = String(v).slice(0, 10_000);
    }
  }
  return out;
}

async function checkDuplicateNip(nip: string | null, exceptId: number | null, reply: FastifyReply) {
  if (!nip) return true;
  const [dup] = await db.select({ name: schema.clients.name, owner: schema.users.fullName })
    .from(schema.clients)
    .leftJoin(schema.users, eq(schema.users.id, schema.clients.ownerId))
    .where(and(eq(schema.clients.nip, nip), exceptId ? ne(schema.clients.id, exceptId) : undefined));
  if (dup) {
    reply.code(409).send({ error: `Klient z tym NIP już istnieje: ${dup.name} (opiekun: ${dup.owner ?? 'brak'})` });
    return false;
  }
  return true;
}

async function logActivity(clientId: number, authorId: number, type: 'status_change' | 'system', content: string) {
  await db.insert(schema.activities).values({ clientId, authorId, type, content });
}

async function statusName(id: number | null) {
  if (!id) return 'brak';
  const [s] = await db.select({ name: schema.clientStatuses.name }).from(schema.clientStatuses).where(eq(schema.clientStatuses.id, id));
  return s?.name ?? 'brak';
}

async function userName(id: number | null) {
  if (!id) return 'brak';
  const [u] = await db.select({ fullName: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, id));
  return u?.fullName ?? 'brak';
}

function resolveOwner(user: SessionUser, requested: number | null | undefined, current: number | null) {
  if (!seesAllClients(user)) return current ?? user.id; // handlowiec nie zmienia opiekuna
  return requested === undefined ? (current ?? user.id) : requested;
}

export async function clientRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/voivodeships', async () => VOIVODESHIPS);

  app.get('/api/clients', async (req) => {
    const where = seesAllClients(req.user) ? undefined : eq(schema.clients.ownerId, req.user.id);
    const rows = await db.select({
      client: schema.clients,
      ownerName: schema.users.fullName,
    })
      .from(schema.clients)
      .leftJoin(schema.users, eq(schema.users.id, schema.clients.ownerId))
      .where(where)
      .orderBy(desc(schema.clients.updatedAt));

    const ids = rows.map((r) => r.client.id);
    const contacts = ids.length
      ? await db.select().from(schema.contacts).where(inArray(schema.contacts.clientId, ids))
        .orderBy(desc(schema.contacts.isPrimary), asc(schema.contacts.id))
      : [];
    const primary = new Map<number, typeof contacts[number]>();
    for (const c of contacts) if (!primary.has(c.clientId)) primary.set(c.clientId, c);

    const taskStats = ids.length
      ? await db.select({
        clientId: schema.tasks.clientId,
        open: sql<number>`count(*)`,
        nextDue: sql<string>`min(${schema.tasks.dueAt})`,
      }).from(schema.tasks)
        .where(and(inArray(schema.tasks.clientId, ids), eq(schema.tasks.done, false)))
        .groupBy(schema.tasks.clientId)
      : [];
    const stats = new Map(taskStats.map((t) => [t.clientId, t]));

    return rows.map(({ client, ownerName }) => {
      const p = primary.get(client.id);
      const s = stats.get(client.id);
      return {
        ...client,
        ownerName,
        contactName: p?.name ?? null,
        contactPosition: p?.position ?? null,
        contactPhone: p?.phone ?? null,
        contactEmail: p?.email ?? null,
        openTasks: Number(s?.open ?? 0),
        nextTaskDue: s?.nextDue ? new Date(s.nextDue).toISOString() : null,
      };
    });
  });

  app.get('/api/clients/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const client = await loadClientFor(req.user, params.id, reply);
    if (!client) return;
    const contacts = await db.select().from(schema.contacts)
      .where(eq(schema.contacts.clientId, client.id))
      .orderBy(desc(schema.contacts.isPrimary), asc(schema.contacts.id));
    return { ...client, ownerName: await userName(client.ownerId), contacts };
  });

  app.post('/api/clients', async (req, reply) => {
    const body = parse(clientBody.extend({ contact: contactBody.partial({ name: true }).optional() }), req.body, reply);
    if (!body) return;
    if (!(await checkDuplicateNip(body.nip, null, reply))) return;
    const { contact, ownerId, custom, ...data } = body;
    const [client] = await db.insert(schema.clients).values({
      ...data,
      ownerId: resolveOwner(req.user, ownerId, null),
      custom: await sanitizeCustom(custom),
    }).returning();
    if (contact?.name) {
      await db.insert(schema.contacts).values({ ...contact, name: contact.name, clientId: client.id, isPrimary: true });
    }
    await logActivity(client.id, req.user.id, 'system', 'Utworzono klienta');
    return client;
  });

  app.put('/api/clients/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(clientBody.partial(), req.body, reply);
    if (!params || !body) return;
    const client = await loadClientFor(req.user, params.id, reply);
    if (!client) return;
    if (body.nip !== undefined && !(await checkDuplicateNip(body.nip, client.id, reply))) return;

    const { ownerId, custom, ...data } = body;
    const newOwner = resolveOwner(req.user, ownerId, client.ownerId);
    await db.update(schema.clients).set({
      ...data,
      ownerId: newOwner,
      ...(custom ? { custom: await sanitizeCustom(custom, client.custom) } : {}),
      updatedAt: new Date(),
    }).where(eq(schema.clients.id, client.id));

    if (data.statusId !== undefined && data.statusId !== client.statusId) {
      await logActivity(client.id, req.user.id, 'status_change',
        `Zmiana statusu: ${await statusName(client.statusId)} → ${await statusName(data.statusId)}`);
    }
    if (newOwner !== client.ownerId) {
      await logActivity(client.id, req.user.id, 'system',
        `Zmiana opiekuna: ${await userName(client.ownerId)} → ${await userName(newOwner)}`);
    }
    return { ok: true };
  });

  app.delete('/api/clients/:id', { preHandler: requireRole('ADMIN', 'MANAGER') }, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    await db.delete(schema.clients).where(eq(schema.clients.id, params.id));
    return { ok: true };
  });

  // --- Osoby kontaktowe ---
  async function setPrimary(clientId: number, contactId: number) {
    await db.update(schema.contacts).set({ isPrimary: sql`${schema.contacts.id} = ${contactId}` })
      .where(eq(schema.contacts.clientId, clientId));
  }

  app.post('/api/clients/:id/contacts', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(contactBody, req.body, reply);
    if (!params || !body) return;
    const client = await loadClientFor(req.user, params.id, reply);
    if (!client) return;
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.contacts).where(eq(schema.contacts.clientId, client.id));
    const [contact] = await db.insert(schema.contacts).values({ ...body, clientId: client.id }).returning();
    if (body.isPrimary || Number(n) === 0) await setPrimary(client.id, contact.id);
    await touchClient(client.id);
    return contact;
  });

  async function loadContact(req: { user: SessionUser; params: unknown }, reply: FastifyReply) {
    const params = parse(idParam, req.params, reply);
    if (!params) return null;
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, params.id));
    if (!contact) { reply.code(404).send({ error: 'Nie znaleziono kontaktu' }); return null; }
    if (!(await loadClientFor(req.user, contact.clientId, reply))) return null;
    return contact;
  }

  app.put('/api/contacts/:id', async (req, reply) => {
    const body = parse(contactBody.partial(), req.body, reply);
    if (!body) return;
    const contact = await loadContact(req, reply);
    if (!contact) return;
    const { isPrimary, ...data } = body;
    await db.update(schema.contacts).set(data).where(eq(schema.contacts.id, contact.id));
    if (isPrimary) await setPrimary(contact.clientId, contact.id);
    await touchClient(contact.clientId);
    return { ok: true };
  });

  app.delete('/api/contacts/:id', async (req, reply) => {
    const contact = await loadContact(req, reply);
    if (!contact) return;
    await db.delete(schema.contacts).where(eq(schema.contacts.id, contact.id));
    if (contact.isPrimary) {
      const [next] = await db.select().from(schema.contacts).where(eq(schema.contacts.clientId, contact.clientId)).limit(1);
      if (next) await setPrimary(contact.clientId, next.id);
    }
    await touchClient(contact.clientId);
    return { ok: true };
  });
}
