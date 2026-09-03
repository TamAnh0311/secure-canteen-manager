import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';

// Warns before discarding unsaved operator edits, on both in-app navigation
// (router blocker -> confirm dialog) and full tab close/reload (beforeunload).
// Pass `dirty` false while a save is in flight so confirming never prompts.
export function useDirtyNavGuard(dirty: boolean) {
  const { t } = useTranslation('verify');
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(t('dirtyNavPrompt'))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
