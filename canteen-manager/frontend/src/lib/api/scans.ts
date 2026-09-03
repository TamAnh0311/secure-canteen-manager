import { apiFetch } from '@/lib/api-client';
import type {
  ConfirmScanResponse,
  ConfirmScanBody,
  ConfirmGenericScanBody,
  IdentityCandidate,
  IdentityPreview,
  KpiCounts,
  Sheet,
  SheetStatus,
  SubmitScanBody,
  SubmitScanResult,
  VerifyActionResponse,
  VerifyQueueResponse,
} from '@/lib/types';

export interface ListScansParams {
  // Inclusive service_date bounds (YYYY-MM-DD). Caller defaults to today/today.
  dateFrom?: string;
  dateTo?: string;
  status?: SheetStatus;
  limit?: number;
  offset?: number;
}

export interface DateRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function listScans(params: ListScansParams = {}): Promise<Sheet[]> {
  const { dateFrom, dateTo, status, limit, offset } = params;
  return apiFetch<Sheet[]>(
    `/scans${qs({
      dateFrom,
      dateTo,
      status,
      limit: limit !== undefined ? String(limit) : undefined,
      offset: offset !== undefined ? String(offset) : undefined,
    })}`,
  );
}

export function getScan(id: string): Promise<Sheet> {
  return apiFetch<Sheet>(`/scans/${id}`);
}

export function submitScan(body: SubmitScanBody): Promise<SubmitScanResult> {
  return apiFetch<SubmitScanResult>('/scans', {
    method: 'POST',
    body: JSON.stringify({
      sheetId: body.sheetId,
      ...(body.batch === undefined ? {} : { batch: body.batch }),
      checksum: body.checksum,
      imageBase64: body.imageBase64,
    }),
  });
}

// Fabricates a synthetic flagged OMR sheet against the global menu, dated to
// today (demo tool — no scanner needed). Returns the new sheet's id/sheetId/status.
export function generateDemoRecord(): Promise<{
  id: string;
  sheetId: string;
  status: SheetStatus;
}> {
  return apiFetch('/scans/demo', { method: 'POST' });
}

// KPI counts for a service-date range (defaults to today server-side).
export function getKpi(params: DateRangeParams = {}): Promise<KpiCounts> {
  return apiFetch<KpiCounts>(`/scans/kpi${qs({ ...params })}`);
}

// Verify queue for a service-date range, sorted lowest-confidence-first.
export function getVerifyQueue(
  params: DateRangeParams = {},
): Promise<VerifyQueueResponse> {
  return apiFetch<VerifyQueueResponse>(`/scans/verify/queue${qs({ ...params })}`);
}

export function confirmScan(id: string, body: ConfirmScanBody): Promise<ConfirmScanResponse> {
  return apiFetch<ConfirmScanResponse>(`/scans/verify/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      items: body.items,
      ...(body.replacementAck === undefined ? {} : { replacementAck: body.replacementAck }),
    }),
  });
}

export function confirmGenericScan(
  id: string,
  body: ConfirmGenericScanBody,
): Promise<ConfirmScanResponse> {
  return apiFetch<ConfirmScanResponse>(`/scans/verify/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      userId: body.userId,
      items: body.items,
      ...(body.replacementAck === undefined ? {} : { replacementAck: body.replacementAck }),
      ...(body.reason === undefined ? {} : { reason: body.reason }),
    }),
  });
}

export function searchIdentityCandidates(id: string, query: string): Promise<IdentityCandidate[]> {
  return apiFetch<IdentityCandidate[]>(
    `/scans/verify/${id}/candidates?${new URLSearchParams({ q: query }).toString()}`,
  );
}

export function getIdentityPreview(id: string, userId: string): Promise<IdentityPreview> {
  return apiFetch<IdentityPreview>(
    `/scans/verify/${id}/identity-preview?${new URLSearchParams({ userId }).toString()}`,
  );
}

export function rejectScan(id: string): Promise<VerifyActionResponse> {
  return apiFetch<VerifyActionResponse>(`/scans/verify/${id}/reject`, { method: 'POST' });
}

// No-op defer; the sheet stays flagged and in the queue.
export function skipScan(id: string): Promise<VerifyActionResponse> {
  return apiFetch<VerifyActionResponse>(`/scans/verify/${id}/skip`, { method: 'POST' });
}

export function retryScannerArtifact(id: string, artifactId: string): Promise<{ state: string }> {
  return apiFetch<{ state: string }>(
    `/scans/verify/${id}/artifacts/${encodeURIComponent(artifactId)}/retry`,
    { method: 'POST' },
  );
}
