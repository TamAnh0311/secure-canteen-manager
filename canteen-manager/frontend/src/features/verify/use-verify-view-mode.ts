import { useCallback, useState } from 'react';

export type VerifyViewMode = 'guided' | 'detailed';

export const VERIFY_VIEW_MODE_STORAGE_KEY = 'canteen.verify.view-mode';

export function readVerifyViewMode(): VerifyViewMode {
  try {
    const stored = localStorage.getItem(VERIFY_VIEW_MODE_STORAGE_KEY);
    return stored === 'detailed' || stored === 'guided' ? stored : 'guided';
  } catch {
    return 'guided';
  }
}

export function useVerifyViewMode() {
  const [mode, setModeState] = useState<VerifyViewMode>(readVerifyViewMode);

  const setMode = useCallback((next: VerifyViewMode) => {
    setModeState(next);
    try {
      localStorage.setItem(VERIFY_VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // Browser storage can be unavailable in private or locked-down sessions.
    }
  }, []);

  return { mode, setMode };
}
