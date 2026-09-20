import { apiFetch } from '@/lib/api-client';

export interface AuditLogEntry {
  id: string;
  operatorId: string;
  username: string;
  role: string;
  action: string;
  resource: string;
  resourceId: string | null;
  method: string;
  path: string;
  statusCode: number;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AuditLogListResponse {
  data: AuditLogEntry[];
  total: number;
}

export interface AuditLogFilter {
  operatorId?: string;
  action?: string;
  resource?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

/** Fetch paginated audit logs with optional filters. */
export function listAuditLogs(filter: AuditLogFilter = {}): Promise<AuditLogListResponse> {
  const params = new URLSearchParams();
  if (filter.operatorId) params.set('operatorId', filter.operatorId);
  if (filter.action) params.set('action', filter.action);
  if (filter.resource) params.set('resource', filter.resource);
  if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
  if (filter.dateTo) params.set('dateTo', filter.dateTo);
  params.set('limit', String(filter.limit ?? 50));
  params.set('offset', String(filter.offset ?? 0));
  const qs = params.toString();
  return apiFetch<AuditLogListResponse>(`/audit?${qs}`);
}
