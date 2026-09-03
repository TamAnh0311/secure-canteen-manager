import { useEffect } from 'react';

export interface VerifyKeyboardHandlers {
  onConfirm: () => void;
  onReject: () => void;
  onSkip: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleCheatsheet: () => void;
  // Move between order lines and confirm. +1 forward, -1 backward.
  onTabGroup: (direction: 1 | -1) => void;
}

// Wires whole-screen Verify actions while preserving native typing in editable
// order-line controls.
export function useVerifyKeyboard(handlers: VerifyKeyboardHandlers, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function isInteractiveTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      return Boolean(el.closest('button, a, select, [role="button"], [role="link"]'));
    }

    function onKeyDown(e: KeyboardEvent) {
      // Let dialogs and editable order-line fields own their typing.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const typing = isTypingTarget(e.target);
      const interactive = isInteractiveTarget(e.target);
      if (typing || interactive) return;

      // Tab jumps between field GROUPS rather than every individual control, so
      // the operator moves order lines -> confirm. Skip when
      // a real text input has focus so its native tab behavior is preserved.
      if (e.key === 'Tab') {
        e.preventDefault();
        handlers.onTabGroup(e.shiftKey ? -1 : 1);
        return;
      }

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          handlers.onConfirm();
          break;
        case 'r':
        case 'R':
          if (typing) return;
          e.preventDefault();
          handlers.onReject();
          break;
        case 's':
        case 'S':
          if (typing) return;
          e.preventDefault();
          handlers.onSkip();
          break;
        case 'f':
        case 'F':
          if (typing) return;
          e.preventDefault();
          handlers.onFit();
          break;
        case '+':
        case '=':
          if (typing) return;
          e.preventDefault();
          handlers.onZoomIn();
          break;
        case '-':
        case '_':
          if (typing) return;
          e.preventDefault();
          handlers.onZoomOut();
          break;
        case '?':
          // Typing '?' into an editable field must not pop the overlay.
          if (typing) return;
          e.preventDefault();
          handlers.onToggleCheatsheet();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
