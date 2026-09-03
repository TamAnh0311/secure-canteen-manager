import { apiFetch } from '@/lib/api-client';
import type { SyncRun } from '@/lib/types';

export type TriggerSyncResponse =
  | SyncRun
  | { skipped: true; reason: string };

export function getSyncStatus(): Promise<SyncRun | null> {
  return apiFetch<SyncRun | null>('/admin/legacy-sync/status');
}

export function triggerSync(): Promise<TriggerSyncResponse> {
  return apiFetch<TriggerSyncResponse>('/admin/legacy-sync', {
    method: 'POST',
  });
}
