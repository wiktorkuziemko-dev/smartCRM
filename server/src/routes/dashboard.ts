import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { config } from '../config.js';
import { clientEditableBy, clientVisibleTo } from '../lib/access.js';

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
    const rows = await activityByPeriod();
    const result: Record<string, ActivityRow[]> = { today: [], yesterday: [], week: [] };
    for (const r of rows) result[r.period].push(r);
    return result;
  });

  /**
   * Pulpit handlowca: jego klienci, udostępnieni, potencjał, lejek (bez klientów tylko do podglądu)
   * oraz jego aktywność: dziś / wczoraj / 7 dni, dzień po dniu z 14 dni i ostatnie działania.
   */
  app.get('/api/dashboard/me', { preHandler: requireAuth }, async (req) => {
    const me = req.user;
    const visible = clientVisibleTo(me);
    const editable = clientEditableBy(me);

    const [counts] = await db.select({
      owned: sql<number>`count(*) filter (where ${schema.clients.ownerId} = ${me.id})::int`,
      sharedEdit: sql<number>`count(*) filter (where ${schema.clients.ownerId} is distinct from ${me.id} and ${editable})::int`,
      sharedView: sql<number>`count(*) filter (where ${schema.clients.ownerId} is distinct from ${me.id} and not ${editable})::int`,
      potential: sql<number>`coalesce(sum(${schema.clients.potential}) filter (where ${schema.clients.ownerId} = ${me.id}), 0)::int`,
    }).from(schema.clients).where(visible);

    // Lejek: klienci, których handlowiec może edytować (własni + udostępnieni do edycji).
    const funnel = await db.select({
      statusId: schema.clients.statusId,
      count: sql<number>`count(*)::int`,
      potential: sql<number>`coalesce(sum(${schema.clients.potential}), 0)::int`,
    }).from(schema.clients).where(and(visible, editable)).groupBy(schema.clients.statusId);

    const periods = await activityByPeriod(me.id);
    const activity = Object.fromEntries(periods.map((r) => [r.period, r]));

    const tz = config.timezone;
    const { rows: daily } = await db.execute<{ day: string; actions: number; logins: number }>(sql`
      with b as (select (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as t0),
      d as (select generate_series(t0 - interval '13 days', t0, interval '1 day') as s from b)
      select to_char(d.s at time zone ${tz}, 'YYYY-MM-DD') as day,
        (select count(*) from activities a where a.author_id = ${me.id} and a.type in ('meeting', 'call', 'email', 'comment')
           and a.created_at >= d.s and a.created_at < d.s + interval '1 day')::int
        + (select count(*) from clients c where c.created_by_id = ${me.id}
           and c.created_at >= d.s and c.created_at < d.s + interval '1 day')::int as actions,
        (select count(*) from login_events l where l.user_id = ${me.id}
           and l.at >= d.s and l.at < d.s + interval '1 day')::int as logins
      from d order by d.s
    `);

    const recent = await db.select({
      id: schema.activities.id,
      type: schema.activities.type,
      content: schema.activities.content,
      createdAt: schema.activities.createdAt,
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      taskDueAt: schema.tasks.dueAt,
    }).from(schema.activities)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.activities.clientId))
      .leftJoin(schema.tasks, eq(schema.tasks.id, schema.activities.taskId))
      .where(and(eq(schema.activities.authorId, me.id), inArray(schema.activities.type, ['comment', 'call', 'meeting', 'email']), visible))
      .orderBy(desc(schema.activities.createdAt))
      .limit(8);

    return { ...counts, funnel, activity, daily, recent };
  });
}

export interface ActivityRow {
  period: 'today' | 'yesterday' | 'week'; userId: number; fullName: string; lastSeenAt: string | null;
  logins: number; meetings: number; calls: number; emails: number; comments: number; clients: number;
}

/**
 * Liczniki aktywności w okresach dziś / wczoraj / ostatnie 7 dni (granice dni w strefie aplikacji).
 * Bez userId – wszyscy aktywni handlowcy; z userId – tylko ten użytkownik (dowolna rola).
 */
async function activityByPeriod(userId?: number): Promise<ActivityRow[]> {
  const tz = config.timezone;
  const who = userId ? sql`u.id = ${userId}` : sql`u.role = 'SALES' and u.active`;
  const { rows } = await db.execute<{
    period: ActivityRow['period']; user_id: number; full_name: string; last_seen_at: string | null;
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
    where ${who}
    order by u.full_name
  `);
  return rows.map((r) => ({
    period: r.period, userId: r.user_id, fullName: r.full_name,
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
    logins: r.logins, meetings: r.meetings, calls: r.calls, emails: r.emails, comments: r.comments, clients: r.clients,
  }));
}
