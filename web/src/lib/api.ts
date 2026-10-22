export type Role = 'ADMIN' | 'MANAGER' | 'SALES';

export interface Me {
  id: number; login: string; fullName: string; email: string | null; role: Role;
  googleCalendarEmail: string | null; googleEnabled: boolean;
}
export interface UserRow {
  id: number; fullName: string; role: Role; active: boolean;
  login?: string; email?: string | null; googleConnected?: boolean;
}
export interface Tag { id: number; name: string; color: string; position: number; userIds?: number[] }
export interface Status { id: number; name: string; color: string; position: number; active: boolean }
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
export interface CustomField {
  id: number; key: string; label: string; type: FieldType; options: string[];
  position: number; showInList: boolean; active: boolean;
}
export interface Contact {
  id: number; clientId: number; name: string; position: string | null;
  phone: string | null; email: string | null; isPrimary: boolean;
}
export interface Client {
  id: number; name: string; nip: string | null; voivodeship: string | null;
  email: string | null; phone: string | null; potential: number | null;
  currentSolution: string | null; description: string | null;
  statusId: number | null; ownerId: number | null; ownerName: string | null;
  custom: Record<string, unknown>; createdAt: string; updatedAt: string;
  tagIds: number[];
}
export interface ClientRow extends Client {
  contactName: string | null; contactPosition: string | null;
  contactPhone: string | null; contactEmail: string | null;
  openTasks: number; nextTaskDue: string | null;
}
export interface ClientDetail extends Client { contacts: Contact[]; accessUserIds?: number[] }
export type ActivityType = 'comment' | 'call' | 'meeting' | 'email' | 'status_change' | 'system';
export interface Attachment { id: number; fileName: string; mimeType: string; size: number }
export interface Activity {
  id: number; clientId: number; authorId: number | null; authorName: string | null;
  type: ActivityType; content: string; createdAt: string; attachments: Attachment[];
}
export interface Task {
  id: number; title: string; notes: string | null; dueAt: string; done: boolean;
  clientId: number | null; clientName: string | null;
  assigneeId: number; assigneeName: string; googleEventId: string | null;
}
export interface Dashboard {
  byStatus: { statusId: number | null; count: number; potential: number }[];
  recent: { id: number; type: ActivityType; content: string; createdAt: string; clientId: number; clientName: string; authorName: string | null }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string[]>) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    window.location.href = '/login';
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = data.details as Record<string, string[]> | undefined;
    const first = details && Object.values(details).flat()[0];
    throw new ApiError(res.status, first ? `${data.error}: ${first}` : data.error ?? `Błąd ${res.status}`, details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
