import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://smartcrm:smartcrm@localhost:5432/smartcrm',
  uploadDir: path.resolve(env.UPLOAD_DIR ?? './uploads'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB ?? 20),
  /** Ustaw na true, jeśli aplikacja działa za HTTPS. */
  cookieSecure: env.COOKIE_SECURE === 'true',
  sessionDays: Number(env.SESSION_DAYS ?? 14),
  admin: {
    login: env.ADMIN_LOGIN ?? 'admin',
    password: env.ADMIN_PASSWORD ?? 'admin123',
  },
  /** Adres, pod którym użytkownicy otwierają aplikację – trafia do opisu wydarzeń w Kalendarzu Google. */
  appUrl: (env.APP_URL || `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
  timezone: env.TZ ?? 'Europe/Warsaw',
};
