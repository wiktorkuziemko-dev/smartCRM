import type { FastifyInstance } from 'fastify';
import { and, eq, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { googleEnabled } from '../config.js';
import { requireAuth } from '../lib/auth.js';
import { buildAuthUrl, connectAccount, consumeState, disconnectAccount, syncTaskToGoogle } from '../lib/google.js';

export async function googleRoutes(app: FastifyInstance) {
  app.get('/api/google/connect', { preHandler: requireAuth }, async (req, reply) => {
    if (!googleEnabled()) return reply.code(400).send({ error: 'Integracja Google nie jest skonfigurowana' });
    return reply.redirect(buildAuthUrl(req.user.id));
  });

  app.get('/api/google/callback', { preHandler: requireAuth }, async (req, reply) => {
    const { code, state, error } = req.query as Record<string, string | undefined>;
    const userId = state ? consumeState(state) : null;
    if (error || !code || userId !== req.user.id) return reply.redirect('/profile?google=error');
    try {
      await connectAccount(userId, code);
    } catch (err) {
      req.log.error(err);
      return reply.redirect('/profile?google=error');
    }
    // Wyślij do kalendarza istniejące, przyszłe i otwarte zadania użytkownika.
    const open = await db.select({ id: schema.tasks.id }).from(schema.tasks).where(and(
      eq(schema.tasks.assigneeId, userId), eq(schema.tasks.done, false), gte(schema.tasks.dueAt, new Date()),
    ));
    void (async () => { for (const t of open) await syncTaskToGoogle(t.id); })();
    return reply.redirect('/profile?google=ok');
  });

  app.post('/api/google/disconnect', { preHandler: requireAuth }, async (req) => {
    await disconnectAccount(req.user.id);
    await db.update(schema.tasks).set({ googleEventId: null }).where(eq(schema.tasks.assigneeId, req.user.id));
    return { ok: true };
  });
}
