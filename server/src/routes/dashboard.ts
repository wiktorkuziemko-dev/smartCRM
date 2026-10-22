import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { clientVisibleTo } from '../lib/access.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: requireAuth }, async (req) => {
    const own = clientVisibleTo(req.user);

    const byStatus = await db.select({
      statusId: schema.clients.statusId,
      count: sql<number>`count(*)::int`,
      potential: sql<number>`coalesce(sum(${schema.clients.potential}), 0)::int`,
    }).from(schema.clients).where(own).groupBy(schema.clients.statusId);

    const recent = await db.select({
      id: schema.activities.id,
      type: schema.activities.type,
      content: schema.activities.content,
      createdAt: schema.activities.createdAt,
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      authorName: schema.users.fullName,
    }).from(schema.activities)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.activities.clientId))
      .leftJoin(schema.users, eq(schema.users.id, schema.activities.authorId))
      .where(and(own))
      .orderBy(desc(schema.activities.createdAt))
      .limit(15);

    return { byStatus, recent };
  });
}
