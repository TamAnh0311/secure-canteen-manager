import { useCallback, useEffect, useRef } from 'react';

// User-activity events that reset the idle countdown.
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

/**
 * Calls `onReset` after `timeoutMs` of inactivity (no pointer / keyboard / touch events).
 * The timer restarts on any activity. Cleaned up on unmount.
 */
export function useIdleReset(onReset: () => void, timeoutMs = 60_000): void {
  // Keep a stable ref so the effect does not re-run when the caller recreates
  // the callback on every render.
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onResetRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    // Start the initial countdown.
    schedule();

    // Any interaction restarts the timer.
    const handleActivity = () => schedule();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [schedule]);
}
