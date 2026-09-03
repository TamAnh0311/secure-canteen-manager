import { genericOmrFormReference, parseOmrFormReference } from '../omr-form-reference';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('OMR form references', () => {
  it('preserves canonical legacy issued UUID references', () => {
    expect(parseOmrFormReference(UUID)).toEqual({ kind: 'issued', issuedFormToken: UUID });
  });

  it('round-trips a canonical generic template reference', () => {
    const reference = genericOmrFormReference(UUID);
    expect(reference).toBe(`CM-G1:${UUID}`);
    expect(parseOmrFormReference(reference)).toEqual({ kind: 'generic', templateId: UUID });
  });

  it.each([
    '',
    'CM-G1:',
    `cm-g1:${UUID}`,
    'CM-G1:123e4567-e89b-12d3-a456-426614174000',
    `${UUID}:extra`,
  ])('fails closed for malformed reference %p', (value) => {
    expect(parseOmrFormReference(value)).toBeNull();
  });
});
