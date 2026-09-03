import { describe, it, expect } from 'vitest';
import { detentionStatusLabel, DETENTION_LABEL_KEY } from './detention-status';
import type { DetentionStatus } from './types';

// Identity translator: returns the key so the test asserts which label key was looked up,
// independent of the actual locale strings.
const echo = (key: string) => key;

describe('detentionStatusLabel', () => {
  const cases: [DetentionStatus, string][] = [
    ['temporary_hold', 'detentionTemporaryHold'],
    ['pre_trial_detention', 'detentionPreTrialDetention'],
    ['convicted', 'detentionConvicted'],
  ];

  it.each(cases)('%s → key %s', (status, key) => {
    expect(detentionStatusLabel(status, echo)).toBe(key);
  });

  it('returns an em dash for null', () => {
    expect(detentionStatusLabel(null, echo)).toBe('—');
  });

  it('label-key map covers every DetentionStatus value', () => {
    expect(Object.keys(DETENTION_LABEL_KEY).sort()).toEqual(
      ['convicted', 'pre_trial_detention', 'temporary_hold'],
    );
  });
});
