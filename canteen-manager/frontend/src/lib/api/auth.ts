import { apiFetch } from '@/lib/api-client';
import type { Operator } from '@/lib/types';

export interface LoginResponse {
  token: string;
  operator: Operator;
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function me(): Promise<Operator> {
  return apiFetch<Operator>('/auth/me');
}
