import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, seesAllClients, type SessionUser } from '../lib/auth.js';
import { loadClientFor } from '../lib/access.js';
import { syncTaskToGoogle } from '../lib/google.js';
import { idParam, optionalText, parse } from '../lib/validate.js';

const taskBody = z.object({
  title: z.string().trim().min(1, 'Tytuł jest wymagany').max(255),
  notes: optionalText(),
  dueAt: z.coerce.date(),
  done: z.boolean().default(false),
  clientId: z.number().int().nullish().transform((v) => v ?? null),
  assigneeId: z.number().int().optional(),
});

const assignee = alias(schema.users, 'assignee');

/** Handlowiec widzi zadania przypisane do siebie oraz zadania przy swoich klientach. */
function visibility(user: SessionUser): SQL | undefined {
  if (seesAllClients(user)) return undefined;
  return or(eq(schema.tasks.assigneeId, user.id), eq(schema.clients.ownerId, user.id));
}

async function loadTask(user: SessionUser, id: number, reply: FastifyReply) {
  const [row] = await db.select({ task: schema.tasks })
    .from(schema.tasks)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.tasks.clientId))
    .where(and(eq(schema.tasks.id, id), visibility(user)));
  if (!row) { reply.code(404).send({ error: 'Nie znaleziono zadania' }); return null; }
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
    return rows.map(({ task, clientName, assigneeName }) => ({ ...task, clientName, assigneeName }));
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = parse(taskBody, req.body, reply);
    if (!body) return;
    if (body.clientId && !(await loadClientFor(req.user, body.clientId, reply))) return;
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
    const task = await loadTask(req.user, params.id, reply);
    if (!task) return;
    if (body.clientId && !(await loadClientFor(req.user, body.clientId, reply))) return;
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
    const task = await loadTask(req.user, params.id, reply);
    if (!task) return;
    await syncTaskToGoogle(task.id, { deleted: true });
    await db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
    return { ok: true };
  });
}
