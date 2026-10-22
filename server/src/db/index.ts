import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { count } from 'drizzle-orm';
import { config } from '../config.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export const db = drizzle(pool, { schema });
export { schema };

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

const DEFAULT_STATUSES = [
  { name: 'Lead', color: '#94a3b8' },
  { name: 'Pierwszy kontakt', color: '#60a5fa' },
  { name: 'Spotkanie', color: '#3b82f6' },
  { name: 'Oferta', color: '#6366f1' },
  { name: 'Negocjacje', color: '#a855f7' },
  { name: 'Klient aktywny', color: '#10b981' },
  { name: 'Utracony', color: '#ef4444' },
];

const DEFAULT_TAGS = [
  { name: 'przetarg', color: '#f59e0b' },
  { name: 'prywatne', color: '#0ea5e9' },
  { name: 'publiczne', color: '#8b5cf6' },
];

/** Migracje + dane startowe (admin i domyślne statusy przy pierwszym uruchomieniu). */
export async function initDb() {
  await migrate(db, { migrationsFolder });

  const [{ value: userCount }] = await db.select({ value: count() }).from(schema.users);
  if (userCount === 0) {
    await db.insert(schema.users).values({
      login: config.admin.login,
      passwordHash: await bcrypt.hash(config.admin.password, 10),
      fullName: 'Administrator',
      role: 'ADMIN',
    });
    console.log(`Utworzono konto administratora "${config.admin.login}".`);
  }

  const [{ value: statusCount }] = await db.select({ value: count() }).from(schema.clientStatuses);
  if (statusCount === 0) {
    await db.insert(schema.clientStatuses).values(DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i })));
  }

  const [{ value: tagCount }] = await db.select({ value: count() }).from(schema.tags);
  if (tagCount === 0) {
    await db.insert(schema.tags).values(DEFAULT_TAGS.map((t, i) => ({ ...t, position: i })));
  }
}
