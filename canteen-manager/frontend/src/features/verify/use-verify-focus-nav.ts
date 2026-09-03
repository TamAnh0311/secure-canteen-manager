import { useCallback, useRef, type RefObject } from 'react';
import type { FocusedField } from './sheet-image-viewer';
import type { LineEditorHandle } from './line-editor';
import type { ConfirmBarHandle } from './confirm-bar';

interface FocusNavRefs {
  menu: RefObject<LineEditorHandle>;
  confirm: RefObject<ConfirmBarHandle>;
  setFocused: (f: FocusedField) => void;
}

// Tab cycles between editable order lines and confirm.
// instead of every individual control, so the operator reaches any group in
// <=3 presses. A ref mirrors the currently focused group so the handler can
// read it without re-subscribing on every focus change.
export function useVerifyFocusNav({ menu, confirm, setFocused }: FocusNavRefs) {
  const groupRef = useRef<'menu' | 'confirm'>('menu');

  // Called each render with the live focused group so Tab starts from the right
  // place; kept out of state to avoid re-binding the global key handler.
  const syncGroup = useCallback((group: 'menu' | 'confirm') => {
    groupRef.current = group;
  }, []);

  const tabGroup = useCallback(
    (direction: 1 | -1) => {
      const order = ['menu', 'confirm'] as const;
      const i = order.indexOf(groupRef.current);
      const next = order[(i + direction + order.length) % order.length];
      if (next === 'menu') menu.current?.focusFirst();
      else {
        // The confirm group has no cell that reports focus back, so set the
        // focus signal directly (its ROI overlay is intentionally empty).
        confirm.current?.focus();
        setFocused({ group: 'confirm' });
      }
    },
    [menu, confirm, setFocused],
  );

  return { syncGroup, tabGroup };
}
