import { apiFetch } from '@/lib/api-client';
import type { ThresholdConfig, UpdateThresholdBody } from '@/lib/types';

export function getThresholds(): Promise<ThresholdConfig> {
  return apiFetch<ThresholdConfig>('/config/thresholds');
}

export function putThresholds(
  body: UpdateThresholdBody,
): Promise<ThresholdConfig> {
  return apiFetch<ThresholdConfig>('/config/thresholds', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
