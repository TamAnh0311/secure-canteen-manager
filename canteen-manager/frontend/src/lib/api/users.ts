import { apiFetch } from '@/lib/api-client';
import type { User, UserListItem } from '@/lib/types';

export interface ListUsersParams {
  q?: string;
  zone?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listUsers(params: ListUsersParams = {}): Promise<UserListItem[]> {
  const { q, zone, limit, offset } = params;
  return apiFetch<UserListItem[]>(
    `/users${qs({
      q,
      zone,
      limit: limit !== undefined ? String(limit) : undefined,
      offset: offset !== undefined ? String(offset) : undefined,
    })}`,
  );
}

export function getUser(id: string): Promise<User> {
  return apiFetch<User>(`/users/${id}`);
}

export function listZones(): Promise<string[]> {
  return apiFetch<string[]>('/users/zones');
}
