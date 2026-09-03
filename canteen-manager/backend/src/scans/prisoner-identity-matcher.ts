import { createHash } from 'crypto';
import { HandwritingFieldResult } from '../omr/omr-client.service';
import { User } from '../users/user.entity';

export type IdentityReasonCode =
  | 'CELL_EXACT'
  | 'NAME_EXACT'
  | 'NAME_SIMILAR'
  | 'NAME_MISMATCH'
  | 'PRISONER_ID_EXACT'
  | 'PRISONER_ID_CONFLICT'
  | 'OPTIONAL_ID_ABSENT';

export interface RankedPrisonerCandidate {
  userId: string;
  legacyId: string;
  name: string;
  zone: string | null;
  cell: string | null;
  score: number;
  reasons: IdentityReasonCode[];
}

export interface PrisonerIdentityMatchResult {
  candidates: RankedPrisonerCandidate[];
  evidenceFingerprint: string;
  requiredEvidenceUsable: boolean;
  flags: string[];
}

function field(evidence: HandwritingFieldResult[], name: HandwritingFieldResult['field']): HandwritingFieldResult | undefined {
  return evidence.find((item) => item.field === name);
}

function normalizeIdentityText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('vi-VN')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function editDistance(left: string, right: string): number {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function similarity(left: string, right: string): number {
  const width = Math.max(left.length, right.length);
  return width === 0 ? 1 : Math.max(0, 1 - editDistance(left, right) / width);
}

export function rankPrisonerCandidates(
  evidence: HandwritingFieldResult[],
  candidates: User[],
  limit = 10,
): PrisonerIdentityMatchResult {
  const name = field(evidence, 'name');
  const cell = field(evidence, 'cell');
  const prisonerId = field(evidence, 'prisoner_id');
  const requiredEvidenceUsable = name?.status === 'recognized' && cell?.status === 'recognized' &&
    Boolean(name.raw_text?.trim()) && Boolean(cell.raw_text?.trim());
  const flags: string[] = [];
  if (!requiredEvidenceUsable) flags.push('IDENTITY_REQUIRED_FIELD_UNUSABLE');

  const normalizedName = normalizeIdentityText(name?.raw_text);
  const normalizedPrisonerId = normalizeIdentityText(prisonerId?.raw_text);
  const ranked = requiredEvidenceUsable
    ? candidates.map((candidate): RankedPrisonerCandidate => {
        const reasons: IdentityReasonCode[] = ['CELL_EXACT'];
        let score = 100;
        const candidateName = normalizeIdentityText(candidate.name);
        const nameSimilarity = similarity(normalizedName, candidateName);
        if (normalizedName === candidateName) {
          score += 40;
          reasons.push('NAME_EXACT');
        } else if (nameSimilarity >= 0.5) {
          score += Math.round(nameSimilarity * 30);
          reasons.push('NAME_SIMILAR');
        } else {
          reasons.push('NAME_MISMATCH');
        }

        if (prisonerId?.status === 'recognized' && normalizedPrisonerId) {
          if (normalizeIdentityText(candidate.legacyId) === normalizedPrisonerId) {
            score += 50;
            reasons.push('PRISONER_ID_EXACT');
          } else {
            score -= 50;
            reasons.push('PRISONER_ID_CONFLICT');
          }
        } else {
          reasons.push('OPTIONAL_ID_ABSENT');
        }
        return {
          userId: candidate.id,
          legacyId: candidate.legacyId,
          name: candidate.name,
          zone: candidate.zone,
          cell: candidate.cell,
          score,
          reasons,
        };
      })
    : [];

  ranked.sort((left, right) =>
    right.score - left.score ||
    left.name.localeCompare(right.name, 'vi') ||
    left.legacyId.localeCompare(right.legacyId) ||
    left.userId.localeCompare(right.userId));
  const bounded = ranked.slice(0, Math.max(0, Math.min(limit, 10)));
  const evidenceFingerprint = createHash('sha256')
    .update(JSON.stringify(evidence.map((item) => ({
      field: item.field,
      status: item.status,
      raw_text: item.raw_text,
      flags: item.flags,
    }))))
    .digest('hex');
  if (candidates.length > 1) flags.push('IDENTITY_CELL_COLLISION');
  if (bounded.some((candidate) => candidate.reasons.includes('PRISONER_ID_CONFLICT'))) {
    flags.push('IDENTITY_OPTIONAL_ID_CONFLICT');
  }
  return { candidates: bounded, evidenceFingerprint, requiredEvidenceUsable, flags };
}
