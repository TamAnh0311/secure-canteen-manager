import { apiFetch } from '@/lib/api-client';

export interface IssuedOmrFormPrint {
  serial: string;
  serviceDate: string;
  issuedAt: string;
  pdfBase64: string;
}

export type OmrFormMode = 'code' | 'full_list';
export type OmrFormOrientation = 'portrait' | 'landscape';

export interface OmrRosterOptions {
  zones: Array<{
    zone: string;
    cells: Array<string | null>;
  }>;
}

export interface OmrRosterPrisoner {
  id: string;
  legacyId: string;
  name: string;
  zone: string;
  cell: string | null;
}

export interface OmrRoster {
  zone: string;
  cell: string | null;
  prisoners: OmrRosterPrisoner[];
}

export interface OmrFormModeCapability {
  mode: OmrFormMode;
  available: boolean;
  unavailableCode: string | null;
  orientation: OmrFormOrientation;
  itemCount: number;
  capacity: number | null;
  templateRevision: string | null;
}

export interface OmrFormCapabilities {
  operationalMode: 'issued' | 'generic';
  maxBatchSize: number;
  modes: OmrFormModeCapability[];
}

export interface GenericOmrMaster {
  mode: OmrFormMode;
  templateId: string;
  revision: string;
  orientation: OmrFormOrientation;
  formReference: string;
  pageCount: 1;
  pdfBase64: string;
}

export interface IssuedOmrFormBatch {
  serviceDate: string;
  issuedAt: string;
  mode: OmrFormMode;
  orientation: OmrFormOrientation;
  pageCount: number;
  manifest: Array<{
    userId: string;
    shortSerial: string;
  }>;
  pdfBase64: string;
}

export function issueOmrForm(userId: string): Promise<IssuedOmrFormPrint> {
  return apiFetch<IssuedOmrFormPrint>('/omr-forms', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function getRosterOptions(): Promise<OmrRosterOptions> {
  return apiFetch<OmrRosterOptions>('/omr-forms/roster/options');
}

export function getRoster(zone: string, cell: string | null): Promise<OmrRoster> {
  const params = new URLSearchParams({ zone });
  if (cell !== null) params.set('cell', cell);
  return apiFetch<OmrRoster>(`/omr-forms/roster?${params.toString()}`);
}

export function getCapabilities(): Promise<OmrFormCapabilities> {
  return apiFetch<OmrFormCapabilities>('/omr-forms/capabilities');
}

export function issueOmrFormBatch(
  userIds: string[],
  mode: OmrFormMode,
): Promise<IssuedOmrFormBatch> {
  return apiFetch<IssuedOmrFormBatch>('/omr-forms/batch', {
    method: 'POST',
    body: JSON.stringify({ userIds: [...new Set(userIds)], mode }),
  });
}

export function getGenericMaster(mode: OmrFormMode): Promise<GenericOmrMaster> {
  return apiFetch<GenericOmrMaster>(`/omr-forms/masters/${mode}`);
}
