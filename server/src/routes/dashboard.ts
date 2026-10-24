import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { config } from '../config.js';
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

  /**
   * Aktywność handlowców (dla kierownika i admina): dziś, wczoraj, ostatnie 7 dni (z dzisiejszym).
   * Wejścia = logowania i powroty do aplikacji po co najmniej 30 min przerwy.
   */
  app.get('/api/dashboard/team', { preHandler: [requireAuth, requireRole('ADMIN', 'MANAGER')] }, async () => {
    const tz = config.timezone;
    const { rows } = await db.execute<{
      period: 'today' | 'yesterday' | 'week'; user_id: number; full_name: string; last_seen_at: string | null;
      logins: number; meetings: number; calls: number; emails: number; comments: number; clients: number;
    }>(sql`
      with b as (select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as t0),
      p as (
        select 'today' as period, t0 as s, now() + interval '1 day' as e from b
        union all select 'yesterday', t0 - interval '1 day', t0 from b
        union all select 'week', t0 - interval '6 days', now() + interval '1 day' from b
      )
      select p.period, u.id as user_id, u.full_name, u.last_seen_at,
        (select count(*) from login_events l where l.user_id = u.id and l.at >= p.s and l.at < p.e)::int as logins,
        coalesce(act.meetings, 0) as meetings, coalesce(act.calls, 0) as calls,
        coalesce(act.emails, 0) as emails, coalesce(act.comments, 0) as comments,
        (select count(*) from clients c where c.created_by_id = u.id and c.created_at >= p.s and c.created_at < p.e)::int as clients
      from users u
      cross join p
      left join lateral (
        select count(*) filter (where a.type = 'meeting')::int as meetings,
               count(*) filter (where a.type = 'call')::int as calls,
               count(*) filter (where a.type = 'email')::int as emails,
               count(*) filter (where a.type = 'comment')::int as comments
        from activities a where a.author_id = u.id and a.created_at >= p.s and a.created_at < p.e
      ) act on true
      where u.role = 'SALES' and u.active
      order by u.full_name
    `);
    const result: Record<string, unknown[]> = { today: [], yesterday: [], week: [] };
    for (const r of rows) {
      result[r.period].push({
        userId: r.user_id, fullName: r.full_name, lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
        logins: r.logins, meetings: r.meetings, calls: r.calls, emails: r.emails, comments: r.comments, clients: r.clients,
      });
    }
    return result;
  });
}
