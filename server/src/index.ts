import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { settingsRoutes } from './routes/settings.js';
import { clientRoutes } from './routes/clients.js';
import { activityRoutes } from './routes/activities.js';
import { taskRoutes } from './routes/tasks.js';
import { googleRoutes } from './routes/google.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { importRoutes } from './routes/import.js';
import { gpsRoutes } from './routes/gps.js';
import { reportRoutes } from './routes/reports.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });

await app.register(cookie);
await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 } });

app.get('/api/health', async () => ({ ok: true }));
for (const routes of [authRoutes, userRoutes, settingsRoutes, clientRoutes, activityRoutes, taskRoutes, googleRoutes, dashboardRoutes, importRoutes, gpsRoutes, reportRoutes]) {
  await app.register(routes);
}

// Zbudowany frontend (web/dist) serwowany z tego samego serwera; ścieżki SPA -> index.html.
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nie znaleziono' });
    return reply.sendFile('index.html');
  });
}

await initDb();
await app.listen({ port: config.port, host: '0.0.0.0' });
