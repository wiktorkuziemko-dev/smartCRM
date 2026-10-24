import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, seesAllClients, type SessionUser } from '../lib/auth.js';
import { clientEditableBy, clientVisibleTo, loadClientFor } from '../lib/access.js';
import { syncTaskToGoogle } from '../lib/google.js';
import { idParam, optionalText, parse } from '../lib/validate.js';

const taskBody = z.object({
  title: z.string().trim().min(1, 'Tytuł jest wymagany').max(255),
  type: z.enum(['task', 'call', 'meeting', 'email']).default('task'),
  notes: optionalText(),
  dueAt: z.coerce.date(),
  done: z.boolean().default(false),
  clientId: z.number().int().nullish().transform((v) => v ?? null),
  assigneeId: z.number().int().optional(),
});

const assignee = alias(schema.users, 'assignee');

/** Handlowiec widzi zadania przypisane do siebie oraz zadania przy widocznych dla siebie klientach. */
function visibility(user: SessionUser): SQL | undefined {
  // Zadania zarchiwizowanych klientów są ukryte (zadania bez klienta – widoczne).
  const notArchived = isNull(schema.clients.archivedAt);
  if (seesAllClients(user)) return notArchived;
  return and(notArchived, or(eq(schema.tasks.assigneeId, user.id), clientVisibleTo(user)));
}

/** Zmieniać zadanie może osoba przypisana albo ktoś z prawem edycji klienta. */
function editable(user: SessionUser): SQL<boolean> {
  if (seesAllClients(user)) return sql<boolean>`true`;
  return sql<boolean>`(${or(eq(schema.tasks.assigneeId, user.id), clientEditableBy(user))})`;
}

async function loadTaskForEdit(user: SessionUser, id: number, reply: FastifyReply) {
  const [row] = await db.select({ task: schema.tasks, canEdit: editable(user) })
    .from(schema.tasks)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.tasks.clientId))
    .where(and(eq(schema.tasks.id, id), visibility(user)));
  if (!row) { reply.code(404).send({ error: 'Nie znaleziono zadania' }); return null; }
  if (!row.canEdit) { reply.code(403).send({ error: 'Masz dostęp do tego klienta tylko do podglądu' }); return null; }
  return row.task;
}

/** Handlowiec przypisuje zadania tylko sobie; kierownik i admin – dowolnej osobie. */
function resolveAssignee(user: SessionUser, requested: number | undefined, current?: number) {
  if (!seesAllClients(user)) return current ?? user.id;
  return requested ?? current ?? user.id;
}

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/tasks', async (req, reply) => {
    const q = parse(z.object({
      clientId: z.coerce.number().int().optional(),
      assigneeId: z.coerce.number().int().optional(),
      status: z.enum(['open', 'done', 'all']).default('open'),
    }), req.query, reply);
    if (!q) return;
    const rows = await db.select({
      task: schema.tasks,
      clientName: schema.clients.name,
      assigneeName: assignee.fullName,
      canEdit: editable(req.user),
    })
      .from(schema.tasks)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.tasks.clientId))
      .innerJoin(assignee, eq(assignee.id, schema.tasks.assigneeId))
      .where(and(
        visibility(req.user),
        q.clientId ? eq(schema.tasks.clientId, q.clientId) : undefined,
        q.assigneeId ? eq(schema.tasks.assigneeId, q.assigneeId) : undefined,
        q.status === 'all' ? undefined : eq(schema.tasks.done, q.status === 'done'),
      ))
      .orderBy(asc(schema.tasks.done), asc(schema.tasks.dueAt));
    return rows.map(({ task, clientName, assigneeName, canEdit }) => ({ ...task, clientName, assigneeName, canEdit }));
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = parse(taskBody, req.body, reply);
    if (!body) return;
    if (body.clientId && !(await loadClientFor(req.user, body.clientId, reply, 'edit'))) return;
    const [task] = await db.insert(schema.tasks).values({
      ...body,
      assigneeId: resolveAssignee(req.user, body.assigneeId),
      createdById: req.user.id,
    }).returning();
    void syncTaskToGoogle(task.id);
    return task;
  });

  app.put('/api/tasks/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    const body = parse(taskBody.partial(), req.body, reply);
    if (!params || !body) return;
    const task = await loadTaskForEdit(req.user, params.id, reply);
    if (!task) return;
    // Przeniesienie zadania do innego klienta wymaga prawa edycji tego klienta.
    if (body.clientId && body.clientId !== task.clientId && !(await loadClientFor(req.user, body.clientId, reply, 'edit'))) return;
    await db.update(schema.tasks).set({
      ...body,
      assigneeId: resolveAssignee(req.user, body.assigneeId, task.assigneeId),
    }).where(eq(schema.tasks.id, task.id));
    void syncTaskToGoogle(task.id, { previousAssigneeId: task.assigneeId });
    return { ok: true };
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const task = await loadTaskForEdit(req.user, params.id, reply);
    if (!task) return;
    await syncTaskToGoogle(task.id, { deleted: true });
    // Wpis w historii, którym zaplanowano zadanie, znika razem z nim (wraz z załącznikami).
    const linked = await db.select({ id: schema.activities.id }).from(schema.activities).where(eq(schema.activities.taskId, task.id));
    if (linked.length) {
      const ids = linked.map((a) => a.id);
      const files = await db.select().from(schema.attachments).where(inArray(schema.attachments.activityId, ids));
      await db.delete(schema.activities).where(inArray(schema.activities.id, ids));
      files.forEach((f) => fs.rmSync(path.join(config.uploadDir, f.storedName), { force: true }));
    }
    await db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
    return { ok: true };
  });
}
