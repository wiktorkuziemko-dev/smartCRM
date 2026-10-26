import fs from 'node:fs';
import { auditNote } from '../lib/audit.js';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, seesAllClients } from '../lib/auth.js';
import { syncTaskToGoogle } from '../lib/google.js';
import { loadClientFor, touchClient } from '../lib/access.js';
import { idParam, isPastDue, PAST_DUE_ERROR, parse } from '../lib/validate.js';

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.ms-excel',
]);
const INLINE_MIME = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
const USER_TYPES = new Set(['comment', 'call', 'meeting', 'email']);
/** Te typy wpisów planują zadanie z terminem (komentarz – nie). */
const PLANNED_TYPES = new Set(['call', 'meeting', 'email']);

const taskAssignee = alias(schema.users, 'task_assignee');

const PLANNED_LABELS: Record<string, string> = { call: 'Telefon', meeting: 'Spotkanie', email: 'E-mail' };

/** Tytuł zadania = pierwsza linia treści (przycięta); bez treści – nazwa rodzaju kontaktu. */
function taskTitle(content: string, type: string) {
  const first = content.split('\n')[0].trim();
  if (!first) return PLANNED_LABELS[type];
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

export async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  fs.mkdirSync(config.uploadDir, { recursive: true });

  app.get('/api/clients/:id/activities', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    if (!(await loadClientFor(req.user, params.id, reply))) return;
    const rows = await db.select({
      activity: schema.activities,
      authorName: schema.users.fullName,
      task: {
        id: schema.tasks.id,
        dueAt: schema.tasks.dueAt,
        done: schema.tasks.done,
        assigneeId: schema.tasks.assigneeId,
        assigneeName: taskAssignee.fullName,
      },
    })
      .from(schema.activities)
      .leftJoin(schema.users, eq(schema.users.id, schema.activities.authorId))
      .leftJoin(schema.tasks, eq(schema.tasks.id, schema.activities.taskId))
      .leftJoin(taskAssignee, eq(taskAssignee.id, schema.tasks.assigneeId))
      .where(eq(schema.activities.clientId, params.id))
      .orderBy(desc(schema.activities.createdAt));
    const ids = rows.map((r) => r.activity.id);
    const files = ids.length
      ? await db.select().from(schema.attachments).where(inArray(schema.attachments.activityId, ids)).orderBy(asc(schema.attachments.id))
      : [];
    return rows.map(({ activity, authorName, task }) => ({
      ...activity,
      authorName,
      task: task?.id ? task : null,
      attachments: files.filter((f) => f.activityId === activity.id)
        .map(({ id, fileName, mimeType, size }) => ({ id, fileName, mimeType, size })),
    }));
  });

  /**
   * Nowy wpis w historii: multipart z polami "type", "content" i dowolną liczbą plików "files".
   * Dla telefonu/spotkania/e-maila wymagane jest "dueAt" (nie w przeszłości) – powstaje zadanie
   * powiązane z wpisem; opis jest wtedy opcjonalny.
   * "assigneeId" uwzględniamy tylko dla kierownika i admina; handlowiec planuje zadania dla siebie.
   */
  app.post('/api/clients/:id/activities', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    if (!(await loadClientFor(req.user, params.id, reply, 'edit'))) return;

    let type = 'comment';
    let content = '';
    let dueRaw = '';
    let assigneeRaw = '';
    const saved: { fileName: string; storedName: string; mimeType: string; size: number }[] = [];
    const cleanup = () => saved.forEach((f) => fs.rmSync(path.join(config.uploadDir, f.storedName), { force: true }));

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'type' && USER_TYPES.has(String(part.value))) type = String(part.value);
          if (part.fieldname === 'content') content = String(part.value).slice(0, 20_000);
          if (part.fieldname === 'dueAt') dueRaw = String(part.value);
          if (part.fieldname === 'assigneeId') assigneeRaw = String(part.value);
          continue;
        }
        if (!ALLOWED_MIME.has(part.mimetype)) {
          part.file.resume();
          cleanup();
          return reply.code(400).send({ error: `Niedozwolony typ pliku: ${part.filename}. Dozwolone: zdjęcia, PDF, Word, Excel.` });
        }
        const storedName = `${crypto.randomUUID()}${path.extname(part.filename).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;
        const target = path.join(config.uploadDir, storedName);
        await pipeline(part.file, fs.createWriteStream(target));
        if (part.file.truncated) {
          fs.rmSync(target, { force: true });
          cleanup();
          return reply.code(413).send({ error: `Plik ${part.filename} przekracza ${config.maxUploadMb} MB` });
        }
        saved.push({ fileName: part.filename.slice(0, 255), storedName, mimeType: part.mimetype, size: fs.statSync(target).size });
      }
    } catch (err) {
      cleanup();
      throw err;
    }

    if (!PLANNED_TYPES.has(type) && !content.trim() && saved.length === 0) {
      return reply.code(400).send({ error: 'Wpis nie może być pusty' });
    }

    let taskId: number | null = null;
    if (PLANNED_TYPES.has(type)) {
      const dueAt = new Date(dueRaw);
      if (!dueRaw || Number.isNaN(dueAt.getTime())) { cleanup(); return reply.code(400).send({ error: 'Wybierz datę i godzinę' }); }
      if (isPastDue(dueAt)) { cleanup(); return reply.code(400).send({ error: PAST_DUE_ERROR }); }
      let assigneeId = req.user.id;
      if (seesAllClients(req.user) && assigneeRaw) {
        const [u] = await db.select({ id: schema.users.id }).from(schema.users)
          .where(eq(schema.users.id, Number(assigneeRaw)));
        if (!u) { cleanup(); return reply.code(400).send({ error: 'Nieznana osoba odpowiedzialna' }); }
        assigneeId = u.id;
      }
      const lines = content.trim();
      const [task] = await db.insert(schema.tasks).values({
        title: taskTitle(lines, type),
        notes: lines.includes('\n') || lines.length > 120 ? lines : null,
        type: type as 'call',
        dueAt,
        clientId: params.id,
        assigneeId,
        createdById: req.user.id,
      }).returning();
      taskId = task.id;
      void syncTaskToGoogle(task.id);
    }

    const [activity] = await db.insert(schema.activities).values({
      clientId: params.id,
      authorId: req.user.id,
      type: type as 'comment',
      content: content.trim(),
      taskId,
    }).returning();
    if (saved.length) {
      await db.insert(schema.attachments).values(saved.map((f) => ({ ...f, activityId: activity.id })));
    }
    await touchClient(params.id);
    const kinds: Record<string, string> = { comment: 'Komentarz', call: 'Telefon', meeting: 'Spotkanie', email: 'E-mail' };
    auditNote(req, {
      summary: `${kinds[type] ?? type}: ${content.trim().slice(0, 300)}${saved.length ? ` · załączniki: ${saved.map((f) => f.fileName).join(', ')}` : ''}`,
      details: { type, ...(taskId ? { taskId } : {}), ...(dueRaw ? { dueAt: dueRaw } : {}) },
    });
    return activity;
  });

  app.delete('/api/activities/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const [activity] = await db.select().from(schema.activities).where(eq(schema.activities.id, params.id));
    if (!activity) return reply.code(404).send({ error: 'Nie znaleziono wpisu' });
    if (!(await loadClientFor(req.user, activity.clientId, reply, 'edit'))) return;
    if (activity.authorId !== req.user.id && req.user.role !== 'ADMIN') {
      return reply.code(403).send({ error: 'Możesz usuwać tylko własne wpisy' });
    }
    const files = await db.select().from(schema.attachments).where(eq(schema.attachments.activityId, activity.id));
    await db.delete(schema.activities).where(eq(schema.activities.id, activity.id));
    // Usunięcie wpisu z historii usuwa też zaplanowane nim zadanie.
    if (activity.taskId) {
      await syncTaskToGoogle(activity.taskId, { deleted: true });
      await db.delete(schema.tasks).where(eq(schema.tasks.id, activity.taskId));
    }
    files.forEach((f) => fs.rmSync(path.join(config.uploadDir, f.storedName), { force: true }));
    return { ok: true };
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const [file] = await db.select({ file: schema.attachments, clientId: schema.activities.clientId })
      .from(schema.attachments)
      .innerJoin(schema.activities, eq(schema.activities.id, schema.attachments.activityId))
      .where(eq(schema.attachments.id, params.id));
    if (!file) return reply.code(404).send({ error: 'Nie znaleziono pliku' });
    if (!(await loadClientFor(req.user, file.clientId, reply))) return;
    const { storedName, mimeType, fileName } = file.file;
    const disposition = INLINE_MIME.test(mimeType) && !(req.query as { download?: string }).download ? 'inline' : 'attachment';
    return reply
      .header('Content-Type', mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(fs.createReadStream(path.join(config.uploadDir, storedName)));
  });
}
