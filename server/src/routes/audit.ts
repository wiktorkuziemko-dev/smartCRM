import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { CATEGORY_LABELS } from '../lib/audit.js';
import { parse } from '../lib/validate.js';
import { dayRange } from '../lib/time.js';

export async function auditRoutes(app: FastifyInstance) {
  /** Zapis eksportu do Excela (plik powstaje w przeglądarce) – sam wpis tworzy dziennik zdarzeń. */
  app.post('/api/audit/export', { preHandler: requireAuth }, async (req, reply) => {
    const body = parse(z.object({ file: z.string().max(200), rows: z.number().int().min(0) }), req.body, reply);
    if (!body) return;
    return { ok: true };
  });

  /** Dziennik zdarzeń dla administratora: filtry, stronicowanie od najnowszych (kursor = id). */
  app.get('/api/admin/audit', { preHandler: [requireAuth, requireRole('ADMIN')] }, async (req, reply) => {
    const q = req.query as { from?: string; to?: string; user?: string; category?: string; q?: string; client?: string; before?: string; limit?: string };
    const where: SQL[] = [];
    if (q.from || q.to) {
      const range = dayRange(q.from ?? '', q.to ?? '');
      if (typeof range === 'string') return reply.code(400).send({ error: range });
      where.push(gte(schema.auditLog.at, range.from));
      if (!range.untilNow) where.push(lt(schema.auditLog.at, range.to));
    }
    if (q.user === 'none') where.push(isNull(schema.auditLog.userId));
    else if (q.user) where.push(eq(schema.auditLog.userId, Number(q.user)));
    if (q.category) where.push(eq(schema.auditLog.category, q.category));
    if (q.client) where.push(eq(schema.auditLog.clientId, Number(q.client)));
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      where.push(or(ilike(schema.auditLog.clientName, like), ilike(schema.auditLog.summary, like), ilike(schema.auditLog.action, like),
        ilike(schema.auditLog.userName, like), ilike(schema.auditLog.ip, like), sql`${schema.auditLog.details}::text ilike ${like}`)!);
    }
    if (q.before) where.push(lt(schema.auditLog.id, Number(q.before)));
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 5000);
    const rows = await db.select().from(schema.auditLog).where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.auditLog.id)).limit(limit + 1);
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit, categories: CATEGORY_LABELS };
  });
}
