import type { FastifyInstance } from 'fastify';
import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../lib/auth.js';
import { parse } from '../lib/validate.js';
import { addDays, todayInTz, zonedDate } from '../lib/time.js';
import {
  DEFAULT_BASE_URL, clearEServerCache, fetchDevices, fetchHistory, fetchPositions, getEServerConfig, mapLimit, md5,
  describeCaPem, normalizeCaPem, removeEServerConfig, saveEServerConfig, summarize,
} from '../lib/eserver.js';

export async function gpsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const adminOnly = { preHandler: requireRole('ADMIN') };

  // --- Administracja → Integracja E-SERVER ---
  app.get('/api/admin/eserver', adminOnly, async () => {
    const cfg = await getEServerConfig();
    const users = await db.select({ id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role, active: schema.users.active, gpsSerial: schema.users.gpsSerial })
      .from(schema.users).orderBy(asc(schema.users.fullName));
    return {
      configured: Boolean(cfg), baseUrl: cfg?.baseUrl ?? DEFAULT_BASE_URL, login: cfg?.login ?? '',
      caPem: cfg?.caPem ?? '', caCerts: describeCaPem(cfg?.caPem),
      users: users.filter((u) => u.active || u.gpsSerial),
    };
  });

  /** Zapis ustawień po sprawdzeniu połączenia (lista pojazdów). Puste hasło = bez zmiany hasła. */
  app.put('/api/admin/eserver', adminOnly, async (req, reply) => {
    const body = parse(z.object({
      baseUrl: z.string().trim().url('Podaj poprawny adres URL').max(300),
      login: z.string().trim().min(1, 'Podaj login').max(200),
      password: z.string().max(200).optional(),
      caPem: z.string().max(50_000).nullable().optional(),
    }), req.body, reply);
    if (!body) return;
    const current = await getEServerConfig();
    const passwordMd5 = body.password ? md5(body.password) : current?.passwordMd5;
    if (!passwordMd5) return reply.code(400).send({ error: 'Podaj hasło do API' });
    let caPem: string | undefined;
    try { caPem = normalizeCaPem(body.caPem); } catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    const cfg = { baseUrl: body.baseUrl.replace(/\/+$/, ''), login: body.login, passwordMd5, ...(caPem ? { caPem } : {}) };
    try {
      const devices = await fetchDevices(cfg, true);
      await saveEServerConfig(cfg);
      return { ok: true, devices: devices.length };
    } catch (err) {
      clearEServerCache();
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.delete('/api/admin/eserver', adminOnly, async () => {
    await removeEServerConfig();
    return { ok: true };
  });

  app.get('/api/admin/eserver/devices', adminOnly, async (_req, reply) => {
    const cfg = await getEServerConfig();
    if (!cfg) return reply.code(400).send({ error: 'Integracja E-SERVER nie jest skonfigurowana' });
    try { return await fetchDevices(cfg); } catch (err) { return reply.code(502).send({ error: (err as Error).message }); }
  });

  /** Powiązanie użytkownika z numerem nadajnika (serial); null odłącza. */
  app.put('/api/admin/eserver/assign', adminOnly, async (req, reply) => {
    const body = parse(z.object({ userId: z.number().int(), serial: z.string().trim().max(32).nullable() }), req.body, reply);
    if (!body) return;
    const serial = body.serial || null;
    if (serial) {
      const [taken] = await db.select({ fullName: schema.users.fullName }).from(schema.users)
        .where(and(eq(schema.users.gpsSerial, serial), ne(schema.users.id, body.userId)));
      if (taken) return reply.code(409).send({ error: `Ten nadajnik jest już przypisany: ${taken.fullName}` });
    }
    await db.update(schema.users).set({ gpsSerial: serial }).where(eq(schema.users.id, body.userId));
    return { ok: true };
  });

  // --- Pulpit kierownika i admina: mapa i statystyki z ostatnich 7 dni ---
  app.get('/api/gps/overview', { preHandler: requireRole('ADMIN', 'MANAGER') }, async () => {
    const cfg = await getEServerConfig();
    if (!cfg) return { configured: false };
    const people = await db.select({ userId: schema.users.id, fullName: schema.users.fullName, serial: schema.users.gpsSerial })
      .from(schema.users).where(and(isNotNull(schema.users.gpsSerial), eq(schema.users.active, true))).orderBy(asc(schema.users.fullName));
    const errors: string[] = [];

    const [devices, positions] = await Promise.all([
      fetchDevices(cfg).catch((e: Error) => { errors.push(e.message); return []; }),
      fetchPositions(cfg).catch((e: Error) => { errors.push(e.message); return []; }),
    ]);

    // Okres: od początku dnia 6 dni temu (strefa aplikacji) do teraz – 7 dni kalendarzowych z dzisiejszym.
    const to = new Date();
    const from = zonedDate(addDays(todayInTz(), -6), '00:00');

    const rows = await mapLimit(people, 4, async (p) => {
      const device = devices.find((d) => d.serial === p.serial);
      const pos = positions.find((x) => (x.serial && x.serial === p.serial) || (device && x.deviceId === device.deviceId)) ?? null;
      let stats = null;
      try {
        stats = summarize(await fetchHistory(cfg, p.serial!, from, to), config.timezone);
      } catch (e) {
        errors.push(`${p.fullName}: ${(e as Error).message}`);
      }
      return {
        userId: p.userId, fullName: p.fullName, serial: p.serial,
        vehicle: device ? { name: device.deviceName, plateNo: device.plateNo } : null,
        position: pos, stats,
      };
    });

    return { configured: true, from: from.toISOString(), to: to.toISOString(), rows, errors: [...new Set(errors)] };
  });
}
