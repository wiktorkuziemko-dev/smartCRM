import type { FastifyInstance } from 'fastify';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import {
  getServiceAccount, parseCalendarId, removeServiceAccount, saveServiceAccount, syncTaskToGoogle, verifyCalendarAccess,
} from '../lib/google.js';

export async function googleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // --- Admin: klucz konta usługi Google ---
  app.get('/api/admin/google', { preHandler: requireRole('ADMIN') }, async () => {
    const account = await getServiceAccount();
    const users = await db.select({ id: schema.users.id, fullName: schema.users.fullName, calendarId: schema.users.googleCalendarId })
      .from(schema.users);
    return { serviceEmail: account?.client_email ?? null, connectedUsers: users.filter((u) => u.calendarId).length };
  });

  app.put('/api/admin/google', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const body = parse(z.object({ json: z.string().min(10).max(20_000) }), req.body, reply);
    if (!body) return;
    try {
      return { serviceEmail: await saveServiceAccount(body.json) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/admin/google', { preHandler: requireRole('ADMIN') }, async () => {
    await removeServiceAccount();
    return { ok: true };
  });

  // --- Użytkownik: własny kalendarz ---
  /** Zapisuje kalendarz użytkownika (link albo ID) po sprawdzeniu dostępu; null odłącza kalendarz. */
  app.put('/api/me/google-calendar', async (req, reply) => {
    const body = parse(z.object({ calendar: z.string().max(2000).nullable() }), req.body, reply);
    if (!body) return;
    if (!body.calendar) {
      await db.update(schema.users).set({ googleCalendarId: null }).where(eq(schema.users.id, req.user.id));
      await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.assigneeId, req.user.id));
      return { calendarId: null };
    }
    if (!(await getServiceAccount())) {
      return reply.code(400).send({ error: 'Administrator nie skonfigurował jeszcze integracji z Kalendarzem Google.' });
    }
    const calendarId = parseCalendarId(body.calendar);
    if (!calendarId) {
      return reply.code(400).send({ error: 'Nie rozpoznaję tego linku. Wklej ID kalendarza (np. jan.kowalski@gmail.com) albo jego adres iCal / link do osadzenia.' });
    }
    try {
      await verifyCalendarAccess(calendarId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    await db.update(schema.users).set({ googleCalendarId: calendarId }).where(eq(schema.users.id, req.user.id));
    // Nowy kalendarz – wydarzenia ze starego nie są już aktualizowane; wyślij przyszłe otwarte zadania.
    await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.assigneeId, req.user.id));
    const open = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(and(
      eq(schema.tasks.assigneeId, req.user.id), eq(schema.tasks.done, false), gte(schema.tasks.dueAt, new Date()),
    ));
    void (async () => { for (const t of open) await syncTaskToGoogle(t.id); })();
    return { calendarId, syncedTasks: open.length };
  });
}
