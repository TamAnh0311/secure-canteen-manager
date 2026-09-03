import { Sheet } from '../sheet.entity';
import { ScannerReviewState } from '../scanner-review-state';

export interface ScanResponseDto {
  id: string;
  sheetId: string;
  batch: string | null;
  serviceDate: string;
  status: string;
  source: 'omr' | 'scanner';
  scannerOutcome: 'accepted' | 'needs_review' | null;
  scannerReviewState: ScannerReviewState | null;
  scannerReviewBlockers: string[];
  avgConfidence: number | null;
  matchedUserId: string | null;
  orderId: string | null;
  flags: string[] | null;
  rejectionCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
}

export function toScanResponse(sheet: Sheet): ScanResponseDto {
  const result = (sheet.resultJson ?? {}) as Record<string, unknown>;
  const scannerOutcome = sheet.admittedMode === 'scanner' &&
    ['accepted', 'needs_review'].includes(String(result.outcome))
    ? result.outcome as 'accepted' | 'needs_review'
    : null;
  return {
    id: sheet.id,
    sheetId: sheet.sheetId,
    batch: sheet.batch,
    serviceDate: sheet.serviceDate,
    status: sheet.status,
    source: sheet.admittedMode === 'scanner' ? 'scanner' : 'omr',
    scannerOutcome,
    scannerReviewState: sheet.admittedMode === 'scanner' ? sheet.scannerReviewState ?? 'needs_review' : null,
    scannerReviewBlockers: sheet.scannerReviewBlockers ?? [],
    avgConfidence: sheet.avgConfidence,
    matchedUserId: sheet.matchedUserId,
    orderId: sheet.orderId,
    flags: sheet.flags,
    rejectionCode: sheet.rejectionCode,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt,
    processedAt: sheet.processedAt,
  };
}
