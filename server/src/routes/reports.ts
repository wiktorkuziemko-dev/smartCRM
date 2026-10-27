import type { FastifyInstance } from 'fastify';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { dayRange } from '../lib/time.js';

/**
 * Raporty dla kierownika i admina. Każdy raport opisuje swoje parametry (formularz w aplikacji buduje się z opisu)
 * i zwraca kolumny + wiersze. Klienci zarchiwizowani są pomijani.
 */

type ParamType = 'days' | 'number' | 'owner' | 'status' | 'tag' | 'voivodeship' | 'user' | 'date' | 'choice';
interface Param {
  key: string; label: string; type: ParamType; default?: string | number; optional?: boolean;
  options?: { value: string; label: string }[]; // dla type 'choice'
}
type ColType = 'text' | 'client' | 'number' | 'days' | 'date' | 'datetime' | 'status';
interface Column { key: string; label: string; type: ColType }
interface Report {
  key: string; group: string; title: string; description: string; params: Param[];
  run: (p: Record<string, string>) => Promise<{ columns: Column[]; rows: Record<string, unknown>[] }>;
}

const OWNER: Param = { key: 'owner', label: 'Opiekun', type: 'owner', optional: true };
const STATUS: Param = { key: 'status', label: 'Status', type: 'status', optional: true };
const TAG: Param = { key: 'tag', label: 'Tag', type: 'tag', optional: true };
const VOIV: Param = { key: 'voivodeship', label: 'Województwo', type: 'voivodeship', optional: true };
const CLIENT_FILTERS = [OWNER, STATUS, TAG, VOIV];

const int = (v: string | undefined, def: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.trunc(n) : def;
};

/** Wspólne filtry klienta: opiekun (id lub „none”), status, tag, województwo. */
function clientWhere(p: Record<string, string>): SQL {
  const parts: SQL[] = [sql`c.archived_at is null`];
  if (p.owner === 'none') parts.push(sql`c.owner_id is null`);
  else if (p.owner) parts.push(sql`c.owner_id = ${int(p.owner, 0)}`);
  if (p.status) parts.push(sql`c.status_id = ${int(p.status, 0)}`);
  if (p.tag) parts.push(sql`exists (select 1 from client_tags ct where ct.client_id = c.id and ct.tag_id = ${int(p.tag, 0)})`);
  if (p.voivodeship) parts.push(sql`c.voivodeship = ${p.voivodeship}`);
  return sql.join(parts, sql` and `);
}

/** Klienci z danymi do raportów: opiekun, status, ostatni kontakt, najbliższe zadanie, zaległe zadania, status od. */
const CLIENTS = sql`
  select c.id as "clientId", c.name, c.nip, c.voivodeship, c.potential, c.email, c.phone,
    c.created_at as "createdAt", c.updated_at as "updatedAt", c.owner_id as "ownerId",
    u.full_name as owner, s.name as status, s.color as "statusColor", s.position as "statusPosition",
    (select max(a.created_at) from activities a where a.client_id = c.id and a.type in ('comment', 'call', 'meeting', 'email')) as "lastContact",
    (select min(t.due_at) from tasks t where t.client_id = c.id and not t.done) as "nextTask",
    (select count(*) from tasks t where t.client_id = c.id and not t.done and t.due_at < now())::int as "overdueTasks",
    coalesce((select max(a.created_at) from activities a where a.client_id = c.id and a.type = 'status_change'), c.created_at) as "statusSince",
    (select count(*) from contacts k where k.client_id = c.id)::int as "contacts"
  from clients c
  left join users u on u.id = c.owner_id
  left join client_statuses s on s.id = c.status_id`;

async function clientRows(where: SQL, order: SQL) {
  const { rows } = await db.execute<Record<string, unknown>>(sql`select * from (${CLIENTS} where ${where}) x ${order}`);
  return rows;
}

const ENTRY_TYPES: Record<string, string> = { comment: 'Komentarz', call: 'Telefon', meeting: 'Spotkanie', email: 'E-mail' };

/**
 * Ostatni wpis w historii każdego klienta (komentarz, telefon, spotkanie, e-mail – także zaplanowane jako zadanie):
 * autor (użytkownik albo etykieta, np. „Poprzedni opiekun”) i treść z rodzajem, datą wpisu i terminem zadania.
 */
async function lastEntries(clientIds: number[]) {
  const out = new Map<number, { lastAuthor: string; lastEntry: string }>();
  if (!clientIds.length) return out;
  const { rows } = await db.execute<{ client_id: number; type: string; content: string; created_at: string; author: string | null; due_at: string | null; done: boolean | null }>(sql`
    select distinct on (a.client_id) a.client_id, a.type, a.content, a.created_at,
      coalesce(u.full_name, a.author_label) as author, t.due_at, t.done
    from activities a
    left join users u on u.id = a.author_id
    left join tasks t on t.id = a.task_id
    where a.client_id in (${sql.join(clientIds.map((id) => sql`${id}`), sql`, `)})
      and a.type in ('comment', 'call', 'meeting', 'email')
    order by a.client_id, a.created_at desc, a.id desc`);
  const fmt = (d: string) => new Date(d).toLocaleString('pl-PL', { timeZone: config.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  for (const r of rows) {
    const kind = ENTRY_TYPES[r.type] ?? r.type;
    const task = r.due_at ? ` (zadanie na ${fmt(r.due_at)}${r.done ? ', wykonane' : ''})` : '';
    const text = r.content.replace(/\s+/g, ' ').trim();
    out.set(r.client_id, {
      lastAuthor: r.author ?? '—',
      lastEntry: `${fmt(r.created_at).slice(0, 10)} · ${kind}${task}${text ? `: ${text.length > 300 ? `${text.slice(0, 300)}…` : text}` : ''}`,
    });
  }
  return out;
}

const daysSince = (d: unknown) => (d ? Math.floor((Date.now() - new Date(d as string).getTime()) / 86_400_000) : null);

const COL = {
  name: { key: 'name', label: 'Klient', type: 'client' },
  nip: { key: 'nip', label: 'NIP', type: 'text' },
  voivodeship: { key: 'voivodeship', label: 'Województwo', type: 'text' },
  owner: { key: 'owner', label: 'Opiekun', type: 'text' },
  status: { key: 'status', label: 'Status', type: 'status' },
  potential: { key: 'potential', label: 'Potencjał', type: 'number' },
  updatedAt: { key: 'updatedAt', label: 'Ostatnia zmiana', type: 'date' },
  createdAt: { key: 'createdAt', label: 'Dodano', type: 'date' },
  lastContact: { key: 'lastContact', label: 'Ostatni kontakt', type: 'date' },
  nextTask: { key: 'nextTask', label: 'Najbliższe zadanie', type: 'datetime' },
} satisfies Record<string, Column>;

const REPORTS: Report[] = [
  // --- Handlowcy ---
  {
    key: 'portfolio', group: 'Handlowcy', title: 'Portfel handlowców',
    description: 'Podsumowanie na osobę: liczba klientów i potencjał oraz zaniedbania – klienci bez kontaktu, bez zaplanowanego kroku, z zaległymi zadaniami.',
    params: [{ key: 'days', label: 'Bez kontaktu dłużej niż (dni)', type: 'days', default: 30 }],
    async run(p) {
      const days = int(p.days, 30);
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        with x as (${CLIENTS} where c.archived_at is null)
        select coalesce(u.full_name, '— bez opiekuna —') as owner, u.last_seen_at as "lastSeen",
          count(x."clientId")::int as clients,
          coalesce(sum(x.potential), 0)::int as potential,
          count(*) filter (where x."clientId" is not null and (x."lastContact" is null or x."lastContact" < now() - make_interval(days => ${days})))::int as "noContact",
          count(*) filter (where x."clientId" is not null and x."nextTask" is null)::int as "noNextStep",
          count(*) filter (where x."overdueTasks" > 0)::int as "withOverdue",
          (select count(*) from tasks t where t.assignee_id = u.id and not t.done and t.due_at < now())::int as "overdueTasks"
        from (select id, full_name, last_seen_at from users where active and role = 'SALES'
              union select id, full_name, last_seen_at from users where id in (select owner_id from clients where archived_at is null)
              union all select null, null, null) u
        left join x on x."ownerId" is not distinct from u.id
        group by u.id, u.full_name, u.last_seen_at
        having u.id is not null or count(x."clientId") > 0
        order by u.id is null, u.full_name`);
      return {
        columns: [
          { key: 'owner', label: 'Opiekun', type: 'text' },
          { key: 'clients', label: 'Klienci', type: 'number' },
          { key: 'potential', label: 'Potencjał', type: 'number' },
          { key: 'noContact', label: `Bez kontaktu > ${days} dni`, type: 'number' },
          { key: 'noNextStep', label: 'Bez zaplanowanego zadania', type: 'number' },
          { key: 'withOverdue', label: 'Klienci z zaległym zadaniem', type: 'number' },
          { key: 'overdueTasks', label: 'Zaległe zadania (wszystkie)', type: 'number' },
          { key: 'lastSeen', label: 'Ostatnio w aplikacji', type: 'datetime' },
        ],
        rows,
      };
    },
  },
  {
    key: 'status-matrix', group: 'Handlowcy', title: 'Klienci wg opiekuna i statusu',
    description: 'Ilu klientów każdy opiekun ma na poszczególnych etapach lejka.',
    params: [TAG, VOIV],
    async run(p) {
      const { rows: statuses } = await db.execute<{ id: number; name: string }>(sql`select id, name from client_statuses where active order by position, id`);
      const { rows: data } = await db.execute<{ owner: string | null; status_id: number | null; n: number }>(sql`
        select u.full_name as owner, c.status_id, count(*)::int as n from clients c left join users u on u.id = c.owner_id
        where ${clientWhere(p)} group by 1, 2`);
      const byOwner = new Map<string, Record<string, unknown>>();
      for (const d of data) {
        const name = d.owner ?? '— bez opiekuna —';
        const row = byOwner.get(name) ?? { owner: name, total: 0 };
        row[`s${d.status_id ?? 0}`] = ((row[`s${d.status_id ?? 0}`] as number) ?? 0) + d.n;
        row.total = (row.total as number) + d.n;
        byOwner.set(name, row);
      }
      const rows = [...byOwner.values()].sort((a, b) => String(a.owner).localeCompare(String(b.owner), 'pl'));
      const hasNoStatus = data.some((d) => d.status_id == null);
      return {
        columns: [
          { key: 'owner', label: 'Opiekun', type: 'text' },
          ...statuses.map((s) => ({ key: `s${s.id}`, label: s.name, type: 'number' as const })),
          ...(hasNoStatus ? [{ key: 's0', label: 'Bez statusu', type: 'number' as const }] : []),
          { key: 'total', label: 'Razem', type: 'number' },
        ],
        rows,
      };
    },
  },
  {
    key: 'new-clients', group: 'Handlowcy', title: 'Nowi klienci w okresie',
    description: 'Klienci dodani w wybranym okresie – kto ich dodał i kto jest opiekunem.',
    params: [{ key: 'from', label: 'Od dnia', type: 'date' }, { key: 'to', label: 'Do dnia', type: 'date' }, OWNER],
    async run(p) {
      const range = dayRange(p.from ?? '', p.to ?? '');
      if (typeof range === 'string') throw new ReportError(range);
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        select x.*, cb.full_name as "createdBy" from (${CLIENTS} where ${clientWhere(p)}) x
        join clients c2 on c2.id = x."clientId" left join users cb on cb.id = c2.created_by_id
        where x."createdAt" >= ${range.from.toISOString()}::timestamptz and x."createdAt" < ${range.to.toISOString()}::timestamptz + interval '1 second'
        order by x."createdAt" desc`);
      return { columns: [COL.name, COL.createdAt, { key: 'createdBy', label: 'Dodał', type: 'text' }, COL.owner, COL.status, COL.potential], rows };
    },
  },
  {
    key: 'access', group: 'Handlowcy', title: 'Dostęp handlowca do klientów',
    description: 'Których klientów widzi wybrany handlowiec i z jakim uprawnieniem (opiekun, edycja, podgląd).',
    params: [{ key: 'user', label: 'Handlowiec', type: 'user' }],
    async run(p) {
      const userId = int(p.user, 0);
      if (!userId) throw new ReportError('Wybierz handlowca');
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        select x.*, case
          when ca.level is not null and x."ownerId" = ${userId} then (case ca.level when 'edit' then 'Opiekun' when 'view' then 'Opiekun – tylko podgląd' end)
          when ca.level is null and x."ownerId" = ${userId} then 'Opiekun'
          when ca.level = 'edit' then 'Udostępniony – edycja' else 'Udostępniony – podgląd' end as access
        from (${CLIENTS} where c.archived_at is null) x
        left join client_access ca on ca.client_id = x."clientId" and ca.user_id = ${userId}
        where coalesce(ca.level::text, case when x."ownerId" = ${userId} then 'edit' else 'none' end) <> 'none'
        order by access, x.name`);
      return { columns: [COL.name, { key: 'access', label: 'Dostęp', type: 'text' }, COL.owner, COL.status, COL.potential], rows };
    },
  },

  // --- Opiekunowie i potencjał ---
  {
    key: 'no-owner', group: 'Klienci', title: 'Klienci bez opiekuna',
    description: 'Klienci, którymi nikt się nie zajmuje – widoczni tylko dla kierownika i admina.',
    params: [STATUS, TAG, VOIV],
    run: async (p) => ({
      columns: [COL.name, COL.nip, COL.voivodeship, COL.status, COL.potential, COL.lastContact, COL.updatedAt],
      rows: await clientRows(sql`${clientWhere(p)} and c.owner_id is null`, sql`order by potential desc nulls last, name`),
    }),
  },
  {
    key: 'with-owner', group: 'Klienci', title: 'Klienci z opiekunem',
    description: 'Klienci przypisani do opiekunów (wszystkich lub wybranego).',
    params: [OWNER, STATUS, TAG, VOIV],
    run: async (p) => ({
      columns: [COL.name, COL.owner, COL.status, COL.potential, COL.voivodeship, COL.lastContact, COL.nextTask, COL.updatedAt],
      rows: await clientRows(sql`${clientWhere(p)} and c.owner_id is not null`, sql`order by owner, name`),
    }),
  },
  {
    key: 'potential', group: 'Klienci', title: 'Klienci wg potencjału',
    description: 'Klienci z potencjałem w podanym przedziale (od–do, sztuki), od największego.',
    params: [{ key: 'min', label: 'Potencjał od', type: 'number', optional: true }, { key: 'max', label: 'Potencjał do', type: 'number', optional: true }, ...CLIENT_FILTERS],
    run: async (p) => {
      const parts = [sql`${clientWhere(p)} and c.potential is not null`];
      if (p.min) parts.push(sql`c.potential >= ${int(p.min, 0)}`);
      if (p.max) parts.push(sql`c.potential <= ${int(p.max, 0)}`);
      return {
        columns: [COL.name, COL.potential, COL.owner, COL.status, COL.voivodeship, COL.lastContact, COL.nextTask],
        rows: await clientRows(sql.join(parts, sql` and `), sql`order by potential desc, name`),
      };
    },
  },

  // --- Aktualność i kontakt ---
  {
    key: 'edit-state', group: 'Aktualność danych', title: 'Klienci wg stanu edycji',
    description: 'Klienci, przy których w wybranym okresie coś się zmieniło (edytowani) albo nic się nie zmieniło (nieedytowani). '
      + 'Zmiana to: edycja danych lub osób kontaktowych, wpis w historii (komentarz, telefon, spotkanie, e-mail), zmiana statusu, tagów, '
      + 'dostępu, zadania oraz dodanie klienta.',
    params: [
      { key: 'mode', label: 'Stan', type: 'choice', default: 'edited',
        options: [{ value: 'edited', label: 'Edytowani w okresie' }, { value: 'unedited', label: 'Nieedytowani w okresie' }] },
      { key: 'from', label: 'Od dnia', type: 'date' }, { key: 'to', label: 'Do dnia', type: 'date' }, ...CLIENT_FILTERS,
    ],
    run: async (p) => {
      const range = dayRange(p.from ?? '', p.to ?? '');
      if (typeof range === 'string') throw new ReportError(range);
      const edited = p.mode !== 'unedited';
      const from = range.from.toISOString();
      const to = range.untilNow ? new Date(Date.now() + 60_000).toISOString() : range.to.toISOString();
      const tz = config.timezone;
      // Zdarzenia zmiany klienta z datą: historia (także wpisy systemowe), dziennik zdarzeń, dodanie i ostatnia zmiana.
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        with events as (
          select client_id, created_at as at from activities
          union all select client_id, at from audit_log where client_id is not null and category in ('client', 'history', 'task', 'access')
          union all select id, created_at from clients
          union all select id, updated_at from clients
        )
        select x.*, e.days as "editDays", e.last_at as "lastEditInRange" from (${CLIENTS} where ${clientWhere(p)}) x
        left join lateral (
          select count(distinct (ev.at at time zone ${tz})::date)::int as days, max(ev.at) as last_at
          from events ev where ev.client_id = x."clientId" and ev.at >= ${from}::timestamptz and ev.at < ${to}::timestamptz
        ) e on true
        where ${edited ? sql`e.days > 0` : sql`e.days = 0 and x."createdAt" < ${to}::timestamptz`}
        order by ${edited ? sql`e.last_at desc` : sql`x."updatedAt"`}`);
      const last = await lastEntries(rows.map((r) => r.clientId as number));
      return {
        columns: edited
          ? [COL.name, COL.owner, COL.status, { key: 'editDays', label: 'Dni ze zmianami w okresie', type: 'days' },
            { key: 'lastEditInRange', label: 'Ostatnia zmiana w okresie', type: 'datetime' },
            { key: 'lastAuthor', label: 'Ostatni wpis – autor', type: 'text' }, { key: 'lastEntry', label: 'Ostatni wpis', type: 'text' }, COL.potential]
          : [COL.name, COL.owner, COL.status, COL.updatedAt, { key: 'daysIdle', label: 'Dni od ostatniej zmiany', type: 'days' },
            { key: 'lastAuthor', label: 'Ostatni wpis – autor', type: 'text' }, { key: 'lastEntry', label: 'Ostatni wpis', type: 'text' }, COL.potential],
        rows: rows.map((r) => ({ ...r, daysIdle: daysSince(r.updatedAt), ...last.get(r.clientId as number) })),
      };
    },
  },
  {
    key: 'no-contact', group: 'Aktualność danych', title: 'Klienci bez kontaktu',
    description: 'Klienci bez komentarza, telefonu, spotkania ani e-maila od podanej liczby dni (lub nigdy).',
    params: [{ key: 'days', label: 'Bez kontaktu dłużej niż (dni)', type: 'days', default: 30 }, ...CLIENT_FILTERS],
    run: async (p) => {
      const days = int(p.days, 30);
      const rows = await clientRows(
        sql`${clientWhere(p)}`,
        sql`where "lastContact" is null or "lastContact" < now() - make_interval(days => ${days}) order by "lastContact" nulls first, potential desc nulls last`,
      );
      return {
        columns: [COL.name, COL.owner, COL.status, COL.potential, COL.lastContact, { key: 'daysNoContact', label: 'Dni bez kontaktu', type: 'days' }, COL.nextTask],
        rows: rows.map((r) => ({ ...r, daysNoContact: daysSince(r.lastContact) })),
      };
    },
  },
  {
    key: 'no-next-step', group: 'Aktualność danych', title: 'Klienci bez zaplanowanego zadania',
    description: 'Klienci, dla których nie zaplanowano żadnego telefonu, spotkania ani e-maila – brak „następnego kroku”.',
    params: CLIENT_FILTERS,
    run: async (p) => ({
      columns: [COL.name, COL.owner, COL.status, COL.potential, COL.lastContact, COL.updatedAt],
      rows: await clientRows(sql`${clientWhere(p)}`, sql`where "nextTask" is null order by potential desc nulls last, name`),
    }),
  },
  {
    key: 'stuck', group: 'Aktualność danych', title: 'Klienci długo w jednym statusie',
    description: 'Klienci, których status nie zmienił się od podanej liczby dni – utknęli w lejku.',
    params: [{ key: 'days', label: 'W statusie dłużej niż (dni)', type: 'days', default: 60 }, ...CLIENT_FILTERS],
    run: async (p) => {
      const rows = await clientRows(sql`${clientWhere(p)} and c.status_id is not null`,
        sql`where "statusSince" < now() - make_interval(days => ${int(p.days, 60)}) order by "statusSince"`);
      return {
        columns: [COL.name, COL.status, { key: 'statusSince', label: 'W statusie od', type: 'date' }, { key: 'daysInStatus', label: 'Dni w statusie', type: 'days' }, COL.owner, COL.potential, COL.lastContact],
        rows: rows.map((r) => ({ ...r, daysInStatus: daysSince(r.statusSince) })),
      };
    },
  },
  {
    key: 'overdue', group: 'Aktualność danych', title: 'Zaległe zadania',
    description: 'Niewykonane zadania po terminie – kto i jak bardzo jest spóźniony.',
    params: [{ key: 'user', label: 'Wykonawca', type: 'user', optional: true }],
    async run(p) {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        select t.id, t.title, t.type, t.due_at as "dueAt", u.full_name as assignee, c.id as "clientId", c.name
        from tasks t join users u on u.id = t.assignee_id left join clients c on c.id = t.client_id
        where not t.done and t.due_at < now() and (c.id is null or c.archived_at is null)
          ${p.user ? sql`and t.assignee_id = ${int(p.user, 0)}` : sql``}
        order by t.due_at`);
      const types: Record<string, string> = { task: 'Zadanie', call: 'Telefon', meeting: 'Spotkanie', email: 'E-mail' };
      return {
        columns: [
          { key: 'dueAt', label: 'Termin', type: 'datetime' }, { key: 'daysLate', label: 'Dni spóźnienia', type: 'days' },
          { key: 'assignee', label: 'Wykonawca', type: 'text' }, { key: 'typeLabel', label: 'Rodzaj', type: 'text' },
          { key: 'title', label: 'Zadanie', type: 'text' }, COL.name,
        ],
        rows: rows.map((r) => ({ ...r, typeLabel: types[r.type as string] ?? r.type, daysLate: daysSince(r.dueAt) })),
      };
    },
  },

  // --- Jakość danych ---
  {
    key: 'incomplete', group: 'Jakość danych', title: 'Niekompletne dane klientów',
    description: 'Klienci bez NIP, e-maila, telefonu, województwa, potencjału, statusu lub osoby kontaktowej.',
    params: CLIENT_FILTERS,
    run: async (p) => {
      const rows = await clientRows(sql`${clientWhere(p)}`, sql`order by name`);
      const checks: [string, (r: Record<string, unknown>) => boolean][] = [
        ['NIP', (r) => !r.nip], ['e-mail', (r) => !r.email], ['telefon', (r) => !r.phone], ['województwo', (r) => !r.voivodeship],
        ['potencjał', (r) => r.potential == null], ['status', (r) => !r.status], ['osoba kontaktowa', (r) => !r.contacts],
      ];
      const out = rows.map((r): Record<string, unknown> & { missingCount: number } => {
        const missing = checks.filter(([, f]) => f(r)).map(([n]) => n);
        return { ...r, missing: missing.join(', '), missingCount: missing.length };
      }).filter((r) => r.missingCount > 0).sort((a, b) => b.missingCount - a.missingCount || String(a.name).localeCompare(String(b.name), 'pl'));
      return {
        columns: [COL.name, { key: 'missing', label: 'Brakuje', type: 'text' }, { key: 'missingCount', label: 'Braków', type: 'number' }, COL.owner, COL.status],
        rows: out,
      };
    },
  },
  {
    key: 'duplicates', group: 'Jakość danych', title: 'Możliwe duplikaty',
    description: 'Klienci z tym samym NIP-em lub bardzo podobną nazwą – do sprawdzenia i ewentualnego połączenia.',
    params: [],
    async run() {
      const { rows } = await db.execute<Record<string, unknown>>(sql`
        with x as (${CLIENTS} where c.archived_at is null),
        k as (
          select "clientId", 'NIP ' || regexp_replace(nip, '\\D', '', 'g') as key from x where length(regexp_replace(coalesce(nip, ''), '\\D', '', 'g')) >= 10
          union
          select "clientId", 'Nazwa: ' || lower(regexp_replace(regexp_replace(name, '(sp\\.? ?z ?o\\.? ?o\\.?|s\\.? ?a\\.?|spółka.*)$', '', 'i'), '[^[:alnum:]]', '', 'g'))
          from x where length(regexp_replace(name, '[^[:alnum:]]', '', 'g')) >= 3
        ),
        d as (select key from k group by key having count(*) > 1)
        select k.key as "group", x.* from k join d using (key) join x using ("clientId") order by k.key, x.name`);
      return {
        columns: [{ key: 'group', label: 'Wspólne', type: 'text' }, COL.name, COL.nip, COL.owner, COL.status, COL.createdAt],
        rows,
      };
    },
  },
];

class ReportError extends Error {}

export async function reportRoutes(app: FastifyInstance) {
  const guard = { preHandler: [requireAuth, requireRole('ADMIN', 'MANAGER')] };

  app.get('/api/reports', guard, async () =>
    REPORTS.map(({ key, group, title, description, params }) => ({ key, group, title, description, params })));

  app.get('/api/reports/:key', guard, async (req, reply) => {
    const report = REPORTS.find((r) => r.key === (req.params as { key: string }).key);
    if (!report) return reply.code(404).send({ error: 'Nie ma takiego raportu' });
    try {
      const result = await report.run(req.query as Record<string, string>);
      // Daty z zapytań SQL przychodzą jako tekst Postgresa – ujednolicamy do ISO.
      const dateKeys = result.columns.filter((c) => c.type === 'date' || c.type === 'datetime').map((c) => c.key);
      for (const row of result.rows) for (const k of dateKeys) if (row[k]) row[k] = new Date(row[k] as string).toISOString();
      return result;
    } catch (err) {
      if (err instanceof ReportError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
