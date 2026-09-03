import type { DetentionStatus } from '@/lib/types';

// Maps a detention status to its `common` namespace label key. Single source of truth shared by
// /audit and /prisoner so the chip text never drifts between screens.
export const DETENTION_LABEL_KEY: Record<DetentionStatus, string> = {
  temporary_hold: 'detentionTemporaryHold',
  pre_trial_detention: 'detentionPreTrialDetention',
  convicted: 'detentionConvicted',
};

// Resolve a detention status to its localized label via the `common` translator. Null → '—'.
export function detentionStatusLabel(
  status: DetentionStatus | null,
  tCommon: (key: string) => string,
): string {
  if (!status) return '—';
  return tCommon(DETENTION_LABEL_KEY[status]);
}
