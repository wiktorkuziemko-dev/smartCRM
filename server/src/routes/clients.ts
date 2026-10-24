import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole, seesAllClients, type SessionUser } from '../lib/auth.js';
import { clientEditableBy, clientVisibleTo, loadClientFor, touchClient } from '../lib/access.js';
import { idParam, optionalText, parse } from '../lib/validate.js';
import { syncTaskToGoogle } from '../lib/google.js';
import { config } from '../config.js';

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
  tagIds: z.array(z.number().int()).max(50).optional(),
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
  const [dup] = await db.select({ name: schema.clients.name, owner: schema.users.fullName, archivedAt: schema.clients.archivedAt })
    .from(schema.clients)
    .leftJoin(schema.users, eq(schema.users.id, schema.clients.ownerId))
    .where(and(eq(schema.clients.nip, nip), exceptId ? ne(schema.clients.id, exceptId) : undefined));
  if (dup?.archivedAt) {
    reply.code(409).send({ error: `Klient z tym NIP jest w archiwum („${dup.name}”) – administrator może go przywrócić.` });
    return false;
  }
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

async function tagIdsByClient(clientIds: number[]) {
  const map = new Map<number, number[]>();
  if (!clientIds.length) return map;
  const rows = await db.select().from(schema.clientTags).where(inArray(schema.clientTags.clientId, clientIds));
  for (const r of rows) map.set(r.clientId, [...(map.get(r.clientId) ?? []), r.tagId]);
  return map;
}

/** Ustawia tagi klienta i zapisuje zmianę w historii. */
async function setClientTags(clientId: number, authorId: number, tagIds: number[], isNew = false) {
  const all = await db.select().from(schema.tags);
  const valid = new Set(all.map((t) => t.id));
  const next = [...new Set(tagIds.filter((id) => valid.has(id)))];
  const prev = (await tagIdsByClient([clientId])).get(clientId) ?? [];
  const added = next.filter((id) => !prev.includes(id));
  const removed = prev.filter((id) => !next.includes(id));
  if (!added.length && !removed.length) return false;
  await db.delete(schema.clientTags).where(eq(schema.clientTags.clientId, clientId));
  if (next.length) await db.insert(schema.clientTags).values(next.map((tagId) => ({ clientId, tagId })));
  if (!isNew) {
    const name = (id: number) => all.find((t) => t.id === id)?.name;
    const parts = [
      added.length && `dodano ${added.map(name).join(', ')}`,
      removed.length && `usunięto ${removed.map(name).join(', ')}`,
    ].filter(Boolean);
    await logActivity(clientId, authorId, 'system', `Tagi: ${parts.join('; ')}`);
  }
  return true;
}

function resolveOwner(user: SessionUser, requested: number | null | undefined, current: number | null) {
  if (!seesAllClients(user)) return current ?? user.id; // handlowiec nie zmienia opiekuna
  return requested === undefined ? (current ?? user.id) : requested;
}

export async function clientRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/voivodeships', async () => VOIVODESHIPS);

  app.get('/api/clients', async (req) => {
    const where = clientVisibleTo(req.user);
    const rows = await db.select({
      client: schema.clients,
      ownerName: schema.users.fullName,
      canEdit: clientEditableBy(req.user),
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
    const tagMap = await tagIdsByClient(ids);

    return rows.map(({ client, ownerName, canEdit }) => {
      const p = primary.get(client.id);
      const s = stats.get(client.id);
      return {
        ...client,
        ownerName,
        canEdit,
        tagIds: tagMap.get(client.id) ?? [],
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
    const tagIds = (await tagIdsByClient([client.id])).get(client.id) ?? [];
    // Dostęp ustawiony przez admina dla poszczególnych handlowców – widoczny tylko dla admina.
    const accessRules = req.user.role === 'ADMIN'
      ? (await db.select({ userId: schema.clientAccess.userId, level: schema.clientAccess.level })
        .from(schema.clientAccess).where(eq(schema.clientAccess.clientId, client.id)))
      : undefined;
    return { ...client, ownerName: await userName(client.ownerId), contacts, tagIds, accessRules };
  });

  app.post('/api/clients', async (req, reply) => {
    const body = parse(clientBody.extend({ contact: contactBody.partial({ name: true }).optional() }), req.body, reply);
    if (!body) return;
    if (!(await checkDuplicateNip(body.nip, null, reply))) return;
    const { contact, ownerId, custom, tagIds, ...data } = body;
    const [client] = await db.insert(schema.clients).values({
      ...data,
      ownerId: resolveOwner(req.user, ownerId, null),
      custom: await sanitizeCustom(custom),
    }).returning();
    if (contact?.name) {
      await db.insert(schema.contacts).values({ ...contact, name: contact.name, clientId: client.id, isPrimary: true });
    }
    if (tagIds?.length) await setClientTags(client.id, req.user.id, tagIds, true);
    await logActivity(client.id, req.user.id, 'system', 'Utworzono klienta');
    return client;
  });

  app.put('/api/clients/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(clientBody.partial(), req.body, reply);
    if (!params || !body) return;
    const client = await loadClientFor(req.user, params.id, reply, 'edit');
    if (!client) return;
    if (body.nip !== undefined && !(await checkDuplicateNip(body.nip, client.id, reply))) return;

    const { ownerId, custom, tagIds, ...data } = body;
    if (tagIds) await setClientTags(client.id, req.user.id, tagIds);
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

  /**
   * Admin ustawia dostęp handlowca do klienta: 'none' | 'view' | 'edit'.
   * null usuwa ustawienie – wtedy o dostępie decydują tagi klienta.
   */
  app.put('/api/clients/:id/access/:userId', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const params = parse(z.object({ id: z.coerce.number().int(), userId: z.coerce.number().int() }), req.params, reply);
    const body = parse(z.object({ level: z.enum(['none', 'view', 'edit']).nullable() }), req.body, reply);
    if (!params || !body) return;
    const client = await loadClientFor(req.user, params.id, reply);
    if (!client) return;
    if (params.userId === client.ownerId) return reply.code(400).send({ error: 'Opiekun klienta ma zawsze pełny dostęp' });
    const where = and(eq(schema.clientAccess.clientId, client.id), eq(schema.clientAccess.userId, params.userId));
    if (body.level === null) {
      await db.delete(schema.clientAccess).where(where);
    } else {
      await db.insert(schema.clientAccess).values({ clientId: client.id, userId: params.userId, level: body.level })
        .onConflictDoUpdate({ target: [schema.clientAccess.clientId, schema.clientAccess.userId], set: { level: body.level } });
    }
    return { ok: true };
  });

  // --- Archiwum (tylko admin) ---

  /** Usunięcie klienta = archiwizacja: znika z aplikacji, ale admin może go przywrócić. */
  app.delete('/api/clients/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const client = await loadClientFor(req.user, params.id, reply);
    if (!client) return;
    if (client.archivedAt) return reply.code(400).send({ error: 'Klient jest już w archiwum' });
    await db.update(schema.clients).set({ archivedAt: new Date(), archivedById: req.user.id })
      .where(eq(schema.clients.id, client.id));
    await logActivity(client.id, req.user.id, 'system', 'Przeniesiono klienta do archiwum');
    // Otwarte zadania znikają z Kalendarza Google (wrócą po przywróceniu klienta).
    const open = await db.select({ id: schema.tasks.id }).from(schema.tasks)
      .where(and(eq(schema.tasks.clientId, client.id), eq(schema.tasks.done, false), isNotNull(schema.tasks.googleEventId)));
    for (const t of open) {
      await syncTaskToGoogle(t.id, { deleted: true });
      await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.id, t.id));
    }
    return { ok: true };
  });

  const archivedBy = alias(schema.users, 'archived_by');
  app.get('/api/clients-archive', { preHandler: requireRole('ADMIN') }, async () => {
    return db.select({
      id: schema.clients.id,
      name: schema.clients.name,
      nip: schema.clients.nip,
      ownerName: schema.users.fullName,
      archivedAt: schema.clients.archivedAt,
      archivedByName: archivedBy.fullName,
    })
      .from(schema.clients)
      .leftJoin(schema.users, eq(schema.users.id, schema.clients.ownerId))
      .leftJoin(archivedBy, eq(archivedBy.id, schema.clients.archivedById))
      .where(isNotNull(schema.clients.archivedAt))
      .orderBy(desc(schema.clients.archivedAt));
  });

  async function loadArchived(id: number, reply: FastifyReply) {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
    if (!client) { reply.code(404).send({ error: 'Nie znaleziono klienta' }); return null; }
    if (!client.archivedAt) { reply.code(400).send({ error: 'Klient nie jest w archiwum' }); return null; }
    return client;
  }

  app.post('/api/clients/:id/restore', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const client = await loadArchived(params.id, reply);
    if (!client) return;
    await db.update(schema.clients).set({ archivedAt: null, archivedById: null, updatedAt: new Date() })
      .where(eq(schema.clients.id, client.id));
    await logActivity(client.id, req.user.id, 'system', 'Przywrócono klienta z archiwum');
    const open = await db.select({ id: schema.tasks.id }).from(schema.tasks)
      .where(and(eq(schema.tasks.clientId, client.id), eq(schema.tasks.done, false)));
    void (async () => { for (const t of open) await syncTaskToGoogle(t.id); })();
    return { ok: true };
  });

  /**
   * Trwałe usunięcie klienta z archiwum: dane, osoby kontaktowe, historia, zadania, tagi,
   * ustawienia dostępu (kaskadowo w bazie) oraz pliki załączników z dysku.
   */
  app.delete('/api/clients/:id/permanent', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const client = await loadArchived(params.id, reply);
    if (!client) return;
    const files = await db.select({ storedName: schema.attachments.storedName })
      .from(schema.attachments)
      .innerJoin(schema.activities, eq(schema.activities.id, schema.attachments.activityId))
      .where(eq(schema.activities.clientId, client.id));
    await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
    files.forEach((f) => fs.rmSync(path.join(config.uploadDir, f.storedName), { force: true }));
    req.log.info({ clientId: client.id, files: files.length, by: req.user.id }, 'Trwale usunięto klienta');
    return { ok: true, removedFiles: files.length };
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
    const client = await loadClientFor(req.user, params.id, reply, 'edit');
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
    if (!(await loadClientFor(req.user, contact.clientId, reply, 'edit'))) return null;
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
