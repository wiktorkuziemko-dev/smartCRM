import {
  customType, pgTable, pgEnum, serial, integer, text, varchar, boolean, timestamp, jsonb, index, primaryKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'SALES']);
export const fieldTypeEnum = pgEnum('field_type', ['text', 'textarea', 'number', 'date', 'select', 'checkbox']);
/** Poziom dostępu handlowca do klienta: brak / tylko podgląd / pełna edycja. */
export const accessLevelEnum = pgEnum('access_level', ['none', 'view', 'edit']);
/** Rodzaj zadania – telefon, spotkanie i e-mail planuje się z historii kontaktów klienta. */
export const taskTypeEnum = pgEnum('task_type', ['task', 'call', 'meeting', 'email']);
export const activityTypeEnum = pgEnum('activity_type', ['comment', 'call', 'meeting', 'email', 'status_change', 'system']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  login: varchar('login', { length: 64 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 128 }).notNull(),
  email: varchar('email', { length: 255 }),
  role: roleEnum('role').notNull().default('SALES'),
  active: boolean('active').notNull().default(true),
  // ID kalendarza Google udostępnionego kontu usługi aplikacji (zadania trafiają do niego).
  googleCalendarId: varchar('google_calendar_id', { length: 255 }),
  // Ustawienia osobiste, np. kolumny listy klientów widoczne domyślnie.
  settings: jsonb('settings').$type<UserSettings>().notNull().default({}),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  // Numer (serial) nadajnika GPS w systemie E-SERVER – pojazd, którym jeździ użytkownik.
  gpsSerial: varchar('gps_serial', { length: 32 }),
  /** Czas wgrania zdjęcia profilowego (wersja w adresie obrazka); null = brak zdjęcia. */
  avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Rejestr logowań – do statystyk aktywności handlowców. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Zdjęcia profilowe (osobno, żeby lista użytkowników nie ciągnęła obrazków). */
export const userAvatars = pgTable('user_avatars', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  mimeType: varchar('mime_type', { length: 32 }).notNull(),
  data: bytea('data').notNull(),
});

export const loginEvents = pgTable('login_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('login_events_user_at_idx').on(t.userId, t.at)]);

export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/** Stopnie statusu klienta (lejek) – definiowane przez admina. */
export const clientStatuses = pgTable('client_statuses', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  color: varchar('color', { length: 16 }).notNull().default('#3b82f6'),
  position: integer('position').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

/** Dodatkowe pola klienta – definiowane przez admina. */
export const customFields = pgTable('custom_fields', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 64 }).notNull().unique(),
  label: varchar('label', { length: 128 }).notNull(),
  type: fieldTypeEnum('type').notNull().default('text'),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  position: integer('position').notNull().default(0),
  showInList: boolean('show_in_list').notNull().default(true),
  active: boolean('active').notNull().default(true),
});

export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nip: varchar('nip', { length: 20 }),
  voivodeship: varchar('voivodeship', { length: 32 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 64 }),
  potential: integer('potential'),
  currentSolution: text('current_solution'),
  /** Domena wodociągu na platformie SMART (np. „olsztyn”) – do zakładki Testy. */
  domain: varchar('domain', { length: 255 }),
  description: text('description'),
  statusId: integer('status_id').references(() => clientStatuses.id, { onDelete: 'set null' }),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Archiwum: klient ukryty w aplikacji, admin może go przywrócić albo usunąć trwale.
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archivedById: integer('archived_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  // Identyfikator w systemie źródłowym przy imporcie, np. "asana:1212473601512478" (chroni przed duplikatami).
  externalId: varchar('external_id', { length: 64 }).unique(),
}, (t) => [index('clients_owner_idx').on(t.ownerId)]);

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 128 }).notNull(),
  position: varchar('position', { length: 128 }),
  phone: varchar('phone', { length: 64 }),
  email: varchar('email', { length: 255 }),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [index('contacts_client_idx').on(t.clientId)]);

/** Historia kontaktów (oś czasu w stylu Asany). */
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
  type: activityTypeEnum('type').notNull().default('comment'),
  content: text('content').notNull().default(''),
  // Autor spoza listy użytkowników (imię i nazwisko z Asany lub usuniętego użytkownika) – gdy author_id jest pusty.
  authorLabel: varchar('author_label', { length: 128 }),
  // Źródło wpisu, np. "asana" – wpisy z importu nie liczą się do statystyk aktywności.
  source: varchar('source', { length: 16 }),
  externalId: varchar('external_id', { length: 64 }).unique(),
  // Zaplanowany telefon/spotkanie/e-mail: wpis w historii powiązany z zadaniem.
  taskId: integer('task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('activities_client_idx').on(t.clientId)]);

export const attachments = pgTable('attachments', {
  id: serial('id').primaryKey(),
  activityId: integer('activity_id').notNull().references(() => activities.id, { onDelete: 'cascade' }),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  storedName: varchar('stored_name', { length: 128 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  size: integer('size').notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  type: taskTypeEnum('type').notNull().default('task'),
  notes: text('notes'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  done: boolean('done').notNull().default(false),
  clientId: integer('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  assigneeId: integer('assignee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  googleEventId: varchar('google_event_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('tasks_assignee_idx').on(t.assigneeId), index('tasks_client_idx').on(t.clientId)]);

/** Tagi klientów – listą zarządza admin, handlowcy przypisują je klientom. */
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  color: varchar('color', { length: 16 }).notNull().default('#64748b'),
  position: integer('position').notNull().default(0),
});

export const clientTags = pgTable('client_tags', {
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.clientId, t.tagId] }), index('client_tags_tag_idx').on(t.tagId)]);

/**
 * Dostęp handlowca do klienta ustawiony przez admina lub kierownika na karcie klienta.
 * Bez wpisu: opiekun ma edycję, pozostali handlowcy – brak dostępu.
 * Wpis ma pierwszeństwo, także dla opiekuna ('none' / 'view' odbiera mu edycję).
 */
export const clientAccess = pgTable('client_access', {
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  level: accessLevelEnum('level').notNull().default('edit'),
}, (t) => [primaryKey({ columns: [t.clientId, t.userId] }), index('client_access_user_idx').on(t.userId)]);


/** Ustawienia aplikacji (klucz → wartość), np. klucz konta usługi Google. */
/** Dziennik zdarzeń (logi dla administratora): kto, kiedy, co zrobił; nazwy zapisane w chwili zdarzenia. */
export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: varchar('user_name', { length: 128 }),
  ip: varchar('ip', { length: 64 }),
  category: varchar('category', { length: 24 }).notNull(),
  action: varchar('action', { length: 128 }).notNull(),
  clientId: integer('client_id'),
  clientName: varchar('client_name', { length: 255 }),
  summary: text('summary').notNull().default(''),
  details: jsonb('details').$type<Record<string, unknown>>(),
  status: integer('status'),
}, (t) => [index('audit_log_at_idx').on(t.at), index('audit_log_user_idx').on(t.userId), index('audit_log_client_idx').on(t.clientId)]);

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
});

export interface UserSettings {
  clientColumns?: string[];
  /** Kolejność historii na karcie klienta; brak = 'desc' (najnowsze na początku). */
  historyOrder?: 'asc' | 'desc';
}

export type User = typeof users.$inferSelect;
export type Role = User['role'];
export type TaskType = (typeof taskTypeEnum.enumValues)[number];
export type AccessLevel = (typeof accessLevelEnum.enumValues)[number];
