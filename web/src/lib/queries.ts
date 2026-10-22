import { useQuery } from '@tanstack/react-query';
import { api, type ClientRow, type CustomField, type Me, type Status, type Task, type UserRow } from './api';

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/auth/me'), retry: false, staleTime: 60_000 });

export const useStatuses = () =>
  useQuery({ queryKey: ['statuses'], queryFn: () => api.get<Status[]>('/api/statuses'), staleTime: 60_000 });

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

export const ROLE_LABELS: Record<string, string> = { ADMIN: 'Administrator', MANAGER: 'Kierownik', SALES: 'Handlowiec' };
export const seesAll = (me?: Me) => me?.role === 'ADMIN' || me?.role === 'MANAGER';
