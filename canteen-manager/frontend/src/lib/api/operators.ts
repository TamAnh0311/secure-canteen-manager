import { apiFetch } from '@/lib/api-client';
import type { Operator, Role } from '@/lib/types';

export interface CreateOperatorBody {
  username: string;
  password: string;
  displayName: string;
  role: Role;
  zone: string | null;
}

export function listOperators(): Promise<Operator[]> {
  return apiFetch<Operator[]>('/operators');
}

export function createOperator(body: CreateOperatorBody): Promise<Operator> {
  return apiFetch<Operator>('/operators', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deactivateOperator(id: string): Promise<Operator> {
  return apiFetch<Operator>(`/operators/${id}/deactivate`, { method: 'PATCH' });
}

export function updateOperatorZone(id: string, zone: string | null): Promise<Operator> {
  return apiFetch<Operator>(`/operators/${id}/zone`, {
    method: 'PATCH',
    body: JSON.stringify({ zone }),
  });
}
