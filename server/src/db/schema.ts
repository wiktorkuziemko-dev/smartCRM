import {
  pgTable, pgEnum, serial, integer, text, varchar, boolean, timestamp, jsonb, index, primaryKey,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'SALES']);
export const fieldTypeEnum = pgEnum('field_type', ['text', 'textarea', 'number', 'date', 'select', 'checkbox']);
/** Poziom dostępu handlowca do klienta: brak / tylko podgląd / pełna edycja. */
export const accessLevelEnum = pgEnum('access_level', ['none', 'view', 'edit']);
export const activityTypeEnum = pgEnum('activity_type', ['comment', 'call', 'meeting', 'email', 'status_change', 'system']);

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  login: varchar('login', { length: 64 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 128 }).notNull(),
  email: varchar('email', { length: 255 }),
  role: roleEnum('role').notNull().default('SALES'),
  active: boolean('active').notNull().default(true),
  // Google Calendar (opcjonalnie, gdy skonfigurowano OAuth)
  googleRefreshToken: text('google_refresh_token'),
  googleCalendarEmail: varchar('google_calendar_email', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  description: text('description'),
  statusId: integer('status_id').references(() => clientStatuses.id, { onDelete: 'set null' }),
  ownerId: integer('owner_id').references(() => users.id, { onDelete: 'set null' }),
  custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
 * Dostęp handlowca do konkretnego klienta ustawiony przez admina.
 * Ma pierwszeństwo przed dostępem wynikającym z tagów (także 'none' – jawny brak dostępu).
 */
export const clientAccess = pgTable('client_access', {
  clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  level: accessLevelEnum('level').notNull().default('edit'),
}, (t) => [primaryKey({ columns: [t.clientId, t.userId] }), index('client_access_user_idx').on(t.userId)]);

/** Dostęp handlowca do wszystkich klientów oznaczonych danym tagiem ('view' lub 'edit'). */
export const tagAccess = pgTable('tag_access', {
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  level: accessLevelEnum('level').notNull().default('edit'),
}, (t) => [primaryKey({ columns: [t.tagId, t.userId] }), index('tag_access_user_idx').on(t.userId)]);

export type User = typeof users.$inferSelect;
export type Role = User['role'];
export type AccessLevel = (typeof accessLevelEnum.enumValues)[number];
