import { inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { todayInTz, zonedDate } from './time.js';
import { VOIVODESHIPS } from '../routes/clients.js';

/**
 * Import klientów z eksportu JSON Asany.
 *  - task → klient (nazwa, opis z notes, pierwszy e-mail i telefon z opisu),
 *  - projekty → tagi; projekt o nazwie województwa → także pole „Województwo”,
 *  - assignee → opiekun (po e-mailu); brak / osoba spoza SmartCRM → brak opiekuna (widzą tylko admin i kierownik),
 *  - komentarze → historia kontaktów z oryginalnym autorem i datą; autor spoza SmartCRM → „Poprzedni opiekun”,
 *  - due_on → opcjonalnie zadanie dla opiekuna.
 * Identyfikatory Asany (external_id) sprawiają, że ponowny import dodaje tylko nowych klientów i nowe komentarze.
 * Wpisy z importu (source = 'asana') nie liczą się do statystyk aktywności.
 */

export const PREVIOUS_OWNER = 'Poprzedni opiekun';
const SOURCE = 'asana';

export interface ImportOptions {
  completed: 'archive' | 'skip' | 'import';
  dueTasks: 'none' | 'future' | 'all';
  statusId: number | null;
  extractContacts: boolean;
  duplicateNames: 'skip' | 'import';
}

interface AsanaPerson { gid?: string; name?: string; email?: string | null }
interface AsanaComment { gid: string; author?: AsanaPerson | null; created_at?: string; text?: string }
interface AsanaTask {
  gid: string; name?: string; notes?: string; completed?: boolean; completed_at?: string | null;
  due_on?: string | null; due_at?: string | null; created_at?: string; modified_at?: string;
  created_by?: AsanaPerson | null; assignee?: AsanaPerson | null; parent?: unknown;
  projects?: { gid: string; name: string }[]; comments?: AsanaComment[];
}

/** Szuka listy tasków w dowolnym popularnym kształcie pliku: [...], {data:[...]}, {tasks:[...]}. */
export function findTasks(json: unknown): AsanaTask[] {
  const isTaskList = (v: unknown): v is AsanaTask[] =>
    Array.isArray(v) && v.length > 0 && v.every((t) => t && typeof t === 'object' && 'gid' in t && 'name' in t);
  if (isTaskList(json)) return json;
  if (json && typeof json === 'object') {
    for (const key of ['data', 'tasks']) {
      const v = (json as Record<string, unknown>)[key];
      if (isTaskList(v)) return v;
    }
    for (const v of Object.values(json)) {
      const found = findTasks(v);
      if (found.length) return found;
    }
  }
  return [];
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?\(?\d[\d\s\-()]{7,}\d)/g;

function firstEmail(text: string) { return text.match(EMAIL_RE)?.[0] ?? null; }

function firstPhone(text: string) {
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 12) return m[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

const date = (v: string | null | undefined, fallback: Date) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : fallback);
const tagName = (project: string) => project.trim().toLowerCase().slice(0, 64);

const TAG_COLORS = ['#3b82f6', '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#14b8a6', '#ec4899', '#64748b'];

export async function planAndRunImport(json: unknown, options: ImportOptions, importerId: number, dryRun: boolean) {
  const tasks = findTasks(json);
  if (!tasks.length) throw new Error('Nie znalazłem w pliku listy tasków Asany (obiektów z polami "gid" i "name").');

  // --- dane z bazy potrzebne do planu ---
  const users = await db.select().from(schema.users);
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.trim().toLowerCase(), u]));
  const existingClients = await db.select({ id: schema.clients.id, name: schema.clients.name, externalId: schema.clients.externalId }).from(schema.clients);
  const byExternal = new Map(existingClients.filter((c) => c.externalId).map((c) => [c.externalId!, c.id]));
  const existingNames = new Set(existingClients.filter((c) => !c.externalId).map((c) => c.name.trim().toLowerCase()));
  const commentIds = tasks.flatMap((t) => (t.comments ?? []).map((c) => `${SOURCE}:${c.gid}`));
  const existingComments = new Set<string>();
  for (let i = 0; i < commentIds.length; i += 5000) {
    const chunk = commentIds.slice(i, i + 5000);
    const rows = await db.select({ externalId: schema.activities.externalId }).from(schema.activities)
      .where(inArray(schema.activities.externalId, chunk));
    rows.forEach((r) => existingComments.add(r.externalId!));
  }
  const existingTags = new Map((await db.select().from(schema.tags)).map((t) => [t.name, t.id]));
  const statuses = await db.select().from(schema.clientStatuses);
  if (options.statusId && !statuses.some((s) => s.id === options.statusId)) throw new Error('Nieznany status początkowy');

  // --- raport ---
  const report = {
    tasksInFile: tasks.length,
    newClients: 0,
    existingClients: 0,
    newComments: 0,
    commentsByPreviousOwner: 0,
    archived: 0,
    tasksCreated: 0,
    voivodeshipsSet: 0,
    clientsWithoutOwner: 0,
    skipped: { subtasks: 0, completed: 0, duplicates: [] as string[] },
    owners: {} as Record<string, number>,
    unknownPeople: {} as Record<string, number>,
    newTags: [] as string[],
    preview: [] as { name: string; owner: string; tags: string[]; voivodeship: string | null; email: string | null; phone: string | null; comments: number; task: string | null; archived: boolean }[],
  };

  const person = (p: AsanaPerson | null | undefined) => {
    const email = p?.email?.trim().toLowerCase();
    const user = email ? byEmail.get(email) : undefined;
    if (!user && email) report.unknownPeople[email] = (report.unknownPeople[email] ?? 0) + 1;
    return user ?? null;
  };

  const today = todayInTz();
  const newTagNames = new Set<string>();

  type PlannedClient = {
    task: AsanaTask; existingId: number | null; values: typeof schema.clients.$inferInsert;
    tags: string[]; comments: (typeof schema.activities.$inferInsert)[]; created: typeof schema.activities.$inferInsert | null;
    dueTask: Omit<typeof schema.tasks.$inferInsert, 'clientId'> | null;
  };
  const planned: PlannedClient[] = [];

  for (const t of tasks) {
    if (t.parent) { report.skipped.subtasks++; continue; }
    if (t.completed && options.completed === 'skip') { report.skipped.completed++; continue; }

    const externalId = `${SOURCE}:${t.gid}`;
    const existingId = byExternal.get(externalId) ?? null;
    const name = (t.name ?? '').trim().slice(0, 255) || `Klient z Asany ${t.gid}`;
    if (!existingId && options.duplicateNames === 'skip' && existingNames.has(name.toLowerCase())) {
      report.skipped.duplicates.push(name);
      continue;
    }

    const createdAt = date(t.created_at, new Date());
    const comments = (t.comments ?? [])
      .filter((c) => c.gid && (c.text ?? '').trim() && !existingComments.has(`${SOURCE}:${c.gid}`))
      .map((c) => {
        const author = person(c.author);
        if (!author) report.commentsByPreviousOwner++;
        return {
          clientId: 0, type: 'comment' as const, content: c.text!.trim(), createdAt: date(c.created_at, createdAt),
          authorId: author?.id ?? null, authorLabel: author ? null : PREVIOUS_OWNER, source: SOURCE, externalId: `${SOURCE}:${c.gid}`,
        };
      });
    report.newComments += comments.length;

    if (existingId) {
      report.existingClients++;
      planned.push({ task: t, existingId, values: { name }, tags: [], comments, created: null, dueTask: null });
      continue;
    }

    const ownerUser = person(t.assignee);
    const owner = ownerUser?.active ? ownerUser : null;
    if (owner) report.owners[owner.fullName] = (report.owners[owner.fullName] ?? 0) + 1;
    else report.clientsWithoutOwner++;

    const tags = [...new Set((t.projects ?? []).map((p) => tagName(p.name)).filter(Boolean))];
    tags.filter((n) => !existingTags.has(n)).forEach((n) => newTagNames.add(n));
    const voivodeship = (t.projects ?? []).map((p) => p.name.trim().toLowerCase()).find((n) => VOIVODESHIPS.includes(n)) ?? null;
    if (voivodeship) report.voivodeshipsSet++;

    const notes = (t.notes ?? '').trim();
    const archived = Boolean(t.completed && options.completed === 'archive');
    if (archived) report.archived++;

    const creator = person(t.created_by);
    let dueTask: PlannedClient['dueTask'] = null;
    const dueDay = t.due_at ? t.due_at.slice(0, 10) : t.due_on;
    if (owner && dueDay && !t.completed && options.dueTasks !== 'none' && (options.dueTasks === 'all' || dueDay >= today)) {
      dueTask = {
        title: 'Kontakt z klientem (termin z Asany)', type: 'task',
        dueAt: t.due_at ? new Date(t.due_at) : zonedDate(dueDay, '09:00'),
        assigneeId: owner.id, createdById: importerId,
      };
      report.tasksCreated++;
    }

    planned.push({
      task: t, existingId: null, tags, comments, dueTask,
      values: {
        name,
        description: notes ? notes.slice(0, 10_000) : null,
        email: options.extractContacts && notes ? firstEmail(notes) : null,
        phone: options.extractContacts && notes ? firstPhone(notes) : null,
        voivodeship,
        statusId: options.statusId,
        ownerId: owner?.id ?? null,
        createdById: null, // klienci z importu nie liczą się jako „nowi klienci” handlowca
        externalId,
        createdAt,
        updatedAt: date(t.modified_at, createdAt),
        archivedAt: archived ? date(t.completed_at, new Date()) : null,
        archivedById: archived ? importerId : null,
      },
      created: {
        clientId: 0, type: 'system', content: 'Utworzono klienta (import z Asany)', createdAt,
        authorId: creator?.id ?? null, authorLabel: creator ? null : PREVIOUS_OWNER, source: SOURCE,
      },
    });
    report.newClients++;
    if (report.preview.length < 5) {
      report.preview.push({
        name, owner: owner?.fullName ?? 'brak (widzą tylko admin i kierownik)', tags, voivodeship,
        email: planned.at(-1)!.values.email ?? null, phone: planned.at(-1)!.values.phone ?? null,
        comments: comments.length, task: dueTask ? dueDay! : null, archived,
      });
    }
  }
  report.newTags = [...newTagNames];

  if (dryRun) return { dryRun: true, report };

  // --- zapis w jednej transakcji ---
  await db.transaction(async (tx) => {
    const tagIds = new Map(existingTags);
    let colorIdx = tagIds.size;
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${schema.tags.position}), -1)` }).from(schema.tags);
    let position = Number(maxPos) + 1;
    for (const n of newTagNames) {
      const [tag] = await tx.insert(schema.tags).values({ name: n, color: TAG_COLORS[colorIdx++ % TAG_COLORS.length], position: position++ }).returning();
      tagIds.set(n, tag.id);
    }

    for (const p of planned) {
      let clientId = p.existingId;
      if (!clientId) {
        const [client] = await tx.insert(schema.clients).values(p.values).returning({ id: schema.clients.id });
        clientId = client.id;
        if (p.tags.length) await tx.insert(schema.clientTags).values(p.tags.map((n) => ({ clientId: clientId!, tagId: tagIds.get(n)! })));
        if (p.created) await tx.insert(schema.activities).values({ ...p.created, clientId });
        if (p.dueTask) await tx.insert(schema.tasks).values({ ...p.dueTask, clientId });
      }
      if (p.comments.length) {
        await tx.insert(schema.activities).values(p.comments.map((c) => ({ ...c, clientId: clientId! })));
      }
    }
  });

  return { dryRun: false, report };
}

/** Liczba klientów zaimportowanych wcześniej (do informacji w oknie importu). */
export async function importedCount() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.clients).where(isNotNull(schema.clients.externalId));
  return n;
}
