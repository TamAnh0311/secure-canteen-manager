import { createHash } from 'crypto';
import { MenuItem } from '../menu/menu-item.entity';
import { ScannerArtifactJob, ScannerArtifactJobState } from './webhook/scanner-artifact-job.entity';

export type ScannerReviewState = 'ready' | 'needs_review' | 'evidence_pending' | 'evidence_fault';

export interface ScannerReviewEvaluation {
  state: ScannerReviewState;
  blockers: string[];
}

interface ScannerReviewInput {
  result: Record<string, unknown>;
  identityExactMatch: boolean;
  menuItems: MenuItem[];
  artifactJobs: ScannerArtifactJob[];
  currentCatalogueVersion?: string;
}

const terminalArtifactStates = new Set<ScannerArtifactJobState>([
  ScannerArtifactJobState.MISSING,
  ScannerArtifactJobState.PERMANENT_FAILED,
  ScannerArtifactJobState.INTEGRITY_FAULT,
  ScannerArtifactJobState.PURGED,
]);

export function scannerCatalogueVersion(menuItems: MenuItem[]): string {
  const snapshot = menuItems.map((item) => ({
    catalogueItemId: item.code,
    name: item.name.normalize('NFC').trim().replace(/\s+/g, ' '),
    active: item.isActive,
  }));
  return createHash('sha256').update(JSON.stringify(snapshot), 'utf8').digest('hex');
}

function warningCount(field: unknown): number {
  if (!field || typeof field !== 'object') return 0;
  const warnings = (field as Record<string, unknown>).warnings;
  return Array.isArray(warnings) ? warnings.length : 0;
}

function candidateCount(field: unknown): number {
  if (!field || typeof field !== 'object') return 0;
  const candidates = (field as Record<string, unknown>).candidates;
  return Array.isArray(candidates) ? candidates.length : 0;
}

export function evaluateScannerReviewState(input: ScannerReviewInput): ScannerReviewEvaluation {
  const blockers: string[] = [];
  const { result, menuItems, artifactJobs } = input;
  const menuByCode = new Map(menuItems.map((item) => [item.code, item]));

  if (result.outcome !== 'accepted') blockers.push('SCANNER.OUTCOME_NEEDS_REVIEW');
  if (!input.identityExactMatch) blockers.push('SCANNER.IDENTITY_UNRESOLVED');
  if (Array.isArray(result.warnings) && result.warnings.length > 0) {
    blockers.push('SCANNER.RESULT_WARNINGS');
  }

  const catalogueVersion = result.versions && typeof result.versions === 'object'
    ? (result.versions as Record<string, unknown>).catalogue
    : null;
  const currentCatalogueVersion = input.currentCatalogueVersion ?? scannerCatalogueVersion(menuItems);
  if (catalogueVersion !== currentCatalogueVersion) blockers.push('SCANNER.CATALOGUE_DRIFT');

  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length === 0) blockers.push('SCANNER.ITEMS_EMPTY');
  for (const [index, raw] of items.entries()) {
    if (!raw || typeof raw !== 'object') {
      blockers.push(`SCANNER.ITEM_${index}_INVALID`);
      continue;
    }
    const row = raw as Record<string, unknown>;
    const code = typeof row.catalogue_item_id === 'string' ? row.catalogue_item_id : null;
    const menuItem = code ? menuByCode.get(code) : undefined;
    if (!menuItem?.isActive) blockers.push(`SCANNER.ITEM_${index}_UNRESOLVED`);
    if (warningCount(row.item) > 0) blockers.push(`SCANNER.ITEM_${index}_WARNINGS`);
    if (candidateCount(row.item) > 0) blockers.push(`SCANNER.ITEM_${index}_CANDIDATES`);

    const quantityField = row.quantity && typeof row.quantity === 'object'
      ? row.quantity as Record<string, unknown>
      : {};
    const quantity = quantityField.value;
    if (!Number.isInteger(quantity) || Number(quantity) <= 0) {
      blockers.push(`SCANNER.QUANTITY_${index}_INVALID`);
    }
    if (warningCount(quantityField) > 0) blockers.push(`SCANNER.QUANTITY_${index}_WARNINGS`);
    if (candidateCount(quantityField) > 0) blockers.push(`SCANNER.QUANTITY_${index}_CANDIDATES`);
  }

  const declaredArtifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  const jobsById = new Map(artifactJobs.map((job) => [job.artifactId, job]));
  let evidencePending = false;
  let evidenceFault = false;
  for (const raw of declaredArtifacts) {
    if (!raw || typeof raw !== 'object') {
      evidenceFault = true;
      continue;
    }
    const artifactId = (raw as Record<string, unknown>).artifact_id;
    const job = typeof artifactId === 'string' ? jobsById.get(artifactId) : undefined;
    if (!job) {
      evidenceFault = true;
    } else if (terminalArtifactStates.has(job.state) || (
      job.state === ScannerArtifactJobState.AVAILABLE && !job.relativePath
    )) {
      evidenceFault = true;
    } else if (job.state !== ScannerArtifactJobState.AVAILABLE) {
      evidencePending = true;
    }
  }

  if (artifactJobs.length !== declaredArtifacts.length) {
    evidenceFault = true;
  }

  if (evidenceFault) {
    blockers.push('SCANNER.EVIDENCE_FAULT');
    return { state: 'evidence_fault', blockers };
  }
  if (evidencePending) {
    blockers.push('SCANNER.EVIDENCE_PENDING');
    return { state: 'evidence_pending', blockers };
  }
  return blockers.length === 0
    ? { state: 'ready', blockers }
    : { state: 'needs_review', blockers };
}
