import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { clientVisibleTo } from '../lib/access.js';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import { addDays, todayInTz } from '../lib/time.js';
import { mapLimit } from '../lib/eserver.js';
import {
  SMART_DEFAULTS, dayList, fullDomain, getSmartConfig, getToken, pipelineCached, removeSmartConfig, saveSmartConfig, type SmartConfig,
} from '../lib/smart.js';

const MAX_DAYS = 31; // jak w skrypcie: okres analizy najwyżej 31 dni

export async function smartRoutes(app: FastifyInstance) {
  const admin = { preHandler: [requireAuth, requireRole('ADMIN')] };

  // --- Administracja → Integracja ze SMART ---
  app.get('/api/admin/smart', admin, async () => {
    const cfg = await getSmartConfig();
    const tags = await db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).orderBy(asc(schema.tags.position));
    const { password: _, ...rest } = cfg ?? ({} as Partial<SmartConfig>);
    return { configured: Boolean(cfg), ...SMART_DEFAULTS, login: '', loginDomain: '', clientId: '', tagId: null, ...rest, tags };
  });

  /** Zapis po sprawdzeniu logowania (pobranie tokenu). Puste hasło = bez zmiany. */
  app.put('/api/admin/smart', admin, async (req, reply) => {
    const text = (max = 300) => z.string().trim().max(max);
    const body = parse(z.object({
      authUrl: text().url('Podaj poprawny adres logowania'),
      apiUrl: text().url('Podaj poprawny adres API'),
      login: text(200).min(1, 'Podaj login'),
      password: z.string().max(300).optional(),
      loginDomain: text(255).min(1, 'Podaj domenę logowania'),
      clientId: text(255).min(1, 'Podaj client_id'),
      domainSuffix: text(100),
      sort: text(20),
      details: text(20),
      tagId: z.number().int().nullable(),
    }), req.body, reply);
    if (!body) return;
    const current = await getSmartConfig();
    const password = body.password || current?.password;
    if (!password) return reply.code(400).send({ error: 'Podaj hasło' });
    const cfg: SmartConfig = { ...body, password, domainSuffix: body.domainSuffix || SMART_DEFAULTS.domainSuffix,
      sort: body.sort || SMART_DEFAULTS.sort, details: body.details || SMART_DEFAULTS.details };
    try {
      await getToken(cfg, true);
    } catch (err) {
      return reply.code(400).send({ error: `Nie udało się zalogować do SMART: ${(err as Error).message}` });
    }
    await saveSmartConfig(cfg);
    return { ok: true };
  });

  app.delete('/api/admin/smart', admin, async () => {
    await removeSmartConfig();
    return { ok: true };
  });

  // --- Zakładka Testy: klienci z tagiem testowym i wyniki raportowania nakładek ---
  // Admin i kierownik widzą wszystkie wodociągi testowe; handlowiec – te, które widzi (pod opieką i udostępnione).
  app.get('/api/tests', { preHandler: requireAuth }, async (req, reply) => {
    const cfg = await getSmartConfig();
    if (!cfg) return { configured: false };
    if (!cfg.tagId) return { configured: true, tagMissing: true };
    const [tag] = await db.select({ name: schema.tags.name }).from(schema.tags).where(eq(schema.tags.id, cfg.tagId));
    if (!tag) return { configured: true, tagMissing: true };

    // Domyślnie 7 pełnych dni do wczoraj – raport z dnia D dociera najwcześniej D+1.
    const q = req.query as { from?: string; to?: string; fresh?: string };
    const yesterday = addDays(todayInTz(), -1);
    const from = q.from || addDays(yesterday, -6);
    const to = q.to || yesterday;
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(from) || !re.test(to) || from > to) return reply.code(400).send({ error: 'Niepoprawny okres' });
    if (to > todayInTz()) return reply.code(400).send({ error: 'Okres nie może sięgać w przyszłość' });
    const days = dayList(from, to);
    if (days.length > MAX_DAYS) return reply.code(400).send({ error: `Okres może obejmować najwyżej ${MAX_DAYS} dni` });

    const clients = await db.select({ id: schema.clients.id, name: schema.clients.name, domain: schema.clients.domain, ownerName: schema.users.fullName })
      .from(schema.clients)
      .innerJoin(schema.clientTags, and(eq(schema.clientTags.clientId, schema.clients.id), eq(schema.clientTags.tagId, cfg.tagId)))
      .leftJoin(schema.users, eq(schema.users.id, schema.clients.ownerId))
      .where(clientVisibleTo(req.user))
      .orderBy(asc(schema.clients.name));

    const rows = await mapLimit(clients, 3, async (c) => {
      if (!c.domain) return { ...c, error: 'Brak domeny – uzupełnij pole „Domena” na karcie klienta.', result: null };
      const domain = fullDomain(c.domain, cfg);
      try {
        return { ...c, domain, error: null, result: await pipelineCached(cfg, domain, from, to, q.fresh === '1') };
      } catch (err) {
        return { ...c, domain, error: (err as Error).message, result: null };
      }
    });
    return { configured: true, tag: tag.name, from, to, days, rows };
  });
}
