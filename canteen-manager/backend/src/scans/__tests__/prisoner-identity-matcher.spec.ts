import { HandwritingFieldResult } from '../../omr/omr-client.service';
import { User } from '../../users/user.entity';
import { rankPrisonerCandidates } from '../prisoner-identity-matcher';

function evidence(overrides: Partial<Record<HandwritingFieldResult['field'], string | null>> = {}): HandwritingFieldResult[] {
  return [
    { field: 'name', status: overrides.name === null ? 'abstained' : 'recognized', raw_text: overrides.name ?? 'Nguyễn Văn An', confidence: null, raw_score: 0.8, flags: [] },
    { field: 'cell', status: overrides.cell === null ? 'blank' : 'recognized', raw_text: overrides.cell ?? 'A-01', confidence: null, raw_score: 0.9, flags: [] },
    { field: 'prisoner_id', status: overrides.prisoner_id ? 'recognized' : 'blank', raw_text: overrides.prisoner_id ?? null, confidence: null, raw_score: null, flags: [] },
  ];
}

function user(id: string, name: string, legacyId: string): User {
  return { id, name, legacyId, zone: 'A', cell: 'A-01', isActive: true } as User;
}

describe('prisoner identity matcher', () => {
  it('ranks deterministically from supplied evidence without selecting a user', () => {
    const result = rankPrisonerCandidates(evidence(), [
      user('b', 'Nguyen Van Anh', 'P002'),
      user('a', 'Nguyễn Văn An', 'P001'),
    ]);
    expect(result.candidates.map((candidate) => candidate.userId)).toEqual(['a', 'b']);
    expect(result.candidates[0].reasons).toContain('NAME_EXACT');
    expect(result).not.toHaveProperty('proposedUserId');
  });

  it('treats an optional ID conflict as evidence, never authority', () => {
    const result = rankPrisonerCandidates(evidence({ prisoner_id: 'P999' }), [user('a', 'Nguyễn Văn An', 'P001')]);
    expect(result.candidates[0].reasons).toContain('PRISONER_ID_CONFLICT');
    expect(result.flags).toContain('IDENTITY_OPTIONAL_ID_CONFLICT');
  });

  it('returns no candidates when a required field is unusable', () => {
    const result = rankPrisonerCandidates(evidence({ cell: null }), [user('a', 'Nguyễn Văn An', 'P001')]);
    expect(result.requiredEvidenceUsable).toBe(false);
    expect(result.candidates).toEqual([]);
  });
});
