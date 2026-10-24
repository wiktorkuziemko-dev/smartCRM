import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../lib/auth.js';
import { importedCount, planAndRunImport, type ImportOptions } from '../lib/asanaImport.js';

const optionsSchema = z.object({
  completed: z.enum(['archive', 'skip', 'import']).default('archive'),
  dueTasks: z.enum(['none', 'future', 'all']).default('future'),
  statusId: z.number().int().nullable().default(null),
  extractContacts: z.boolean().default(true),
  duplicateNames: z.enum(['skip', 'import']).default('skip'),
});

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('ADMIN'));

  app.get('/api/admin/import/status', async () => ({ importedClients: await importedCount() }));

  /**
   * Import z Asany: multipart z plikiem JSON ("file"), opcjami ("options", JSON) i "dryRun" ("true" = tylko raport).
   */
  app.post('/api/admin/import/asana', async (req, reply) => {
    let text = '';
    let rawOptions = '{}';
    let dryRun = true;
    for await (const part of req.parts({ limits: { fileSize: 200 * 1024 * 1024 } })) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const c of part.file) chunks.push(c as Buffer);
        if (part.file.truncated) return reply.code(413).send({ error: 'Plik jest większy niż 200 MB' });
        text = Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
      } else if (part.fieldname === 'options') rawOptions = String(part.value);
      else if (part.fieldname === 'dryRun') dryRun = String(part.value) !== 'false';
    }
    if (!text) return reply.code(400).send({ error: 'Nie wybrano pliku' });

    let json: unknown;
    try { json = JSON.parse(text); } catch (err) {
      return reply.code(400).send({ error: `To nie jest poprawny plik JSON: ${(err as Error).message}` });
    }
    const parsed = optionsSchema.safeParse(JSON.parse(rawOptions));
    if (!parsed.success) return reply.code(400).send({ error: 'Niepoprawne opcje importu' });

    try {
      const result = await planAndRunImport(json, parsed.data as ImportOptions, req.user.id, dryRun);
      if (!dryRun) req.log.info({ report: { ...result.report, preview: undefined } }, 'Import z Asany zakończony');
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
