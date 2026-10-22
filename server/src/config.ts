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
  /** Publiczny adres aplikacji, np. https://crm.firma.pl – potrzebny do integracji Google. */
  appUrl: (env.APP_URL || `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  },
  timezone: env.TZ ?? 'Europe/Warsaw',
};

export const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);
