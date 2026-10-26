import { useQuery } from '@tanstack/react-query';
import { api, type ClientRow, type CustomField, type Me, type Status, type Tag, type Task, type UserRow } from './api';

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), retry: false, staleTime: 60_000 });

export const useStatuses = () =>
  useQuery({ queryKey: ['statuses'], queryFn: () => api.get<Status[]>('/api/statuses'), staleTime: 60_000 });

export const useTags = () =>
  useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/api/tags'), staleTime: 60_000 });

export const useFields = () =>
  useQuery({ queryKey: ['fields'], queryFn: () => api.get<CustomField[]>('/api/fields'), staleTime: 60_000 });

export const useUsers = () =>
  useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/api/users'), staleTime: 60_000 });

export const useVoivodeships = () =>
  useQuery({ queryKey: ['voivodeships'], queryFn: () => api.get<string[]>('/api/voivodeships'), staleTime: Infinity });

export const useClients = () =>
  useQuery({ queryKey: ['clients'], queryFn: () => api.get<ClientRow[]>('/api/clients') });

export const useTasks = (params: { clientId?: number; assigneeId?: number; status?: 'open' | 'done' | 'all' }) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && qs.set(k, String(v)));
  return useQuery({ queryKey: ['tasks', params], queryFn: () => api.get<Task[]>(`/api/tasks?${qs}`) });
};

/** Kolumny listy klientów widoczne domyślnie, dopóki użytkownik nie zapisze własnych w Ustawieniach. */
export const DEFAULT_CLIENT_COLUMNS = ['name', 'tags', 'owner', 'updatedAt'];
export const clientColumnsOf = (me?: Me) => {
  const cols = me?.settings.clientColumns?.length ? me.settings.clientColumns : DEFAULT_CLIENT_COLUMNS;
  return cols.includes('name') ? cols : ['name', ...cols];
};

export interface NavLabels { dashboard: string; clients: string; tasks: string; reports: string; settings: string; admin: string }
export const NAV_DEFAULTS: NavLabels = {
  dashboard: 'Pulpit', clients: 'Klienci', tasks: 'Moje zadania', reports: 'Raporty', settings: 'Ustawienia', admin: 'Administracja',
};
/** Nazwy zakładek menu ustawione przez admina (do czasu wczytania – domyślne). */
export const useNavLabels = (enabled = true): NavLabels => {
  const { data } = useQuery({ queryKey: ['nav-labels'], queryFn: () => api.get<NavLabels>('/api/nav-labels'), staleTime: 5 * 60_000, enabled });
  return data ?? NAV_DEFAULTS;
};

export const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrator', MANAGER: 'Kierownik', SALES: 'Handlowiec' };
export const seesAll = (me?: Me) => me?.role === 'ADMIN' || me?.role === 'MANAGER';
