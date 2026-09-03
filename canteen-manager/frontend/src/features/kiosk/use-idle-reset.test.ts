import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIdleReset } from './use-idle-reset';

describe('useIdleReset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires reset callback after timeout elapses with no activity', () => {
    const onReset = vi.fn();
    renderHook(() => useIdleReset(onReset, 5_000));

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(onReset).toHaveBeenCalledOnce();
  });

  it('does NOT fire before timeout elapses', () => {
    const onReset = vi.fn();
    renderHook(() => useIdleReset(onReset, 5_000));

    act(() => {
      vi.advanceTimersByTime(4_999);
    });

    expect(onReset).not.toHaveBeenCalled();
  });

  it('resets the timer on user interaction and fires only after a full idle window', () => {
    const onReset = vi.fn();
    renderHook(() => useIdleReset(onReset, 5_000));

    // Advance 3 s then simulate activity (mousemove).
    act(() => {
      vi.advanceTimersByTime(3_000);
      window.dispatchEvent(new Event('mousemove'));
    });

    // Only 1 s more — should NOT fire yet (needs full 5 s from last activity).
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(onReset).not.toHaveBeenCalled();

    // Advance remaining 4 s — now the full window has elapsed.
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('clears the timer on unmount and does not fire afterwards', () => {
    const onReset = vi.fn();
    const { unmount } = renderHook(() => useIdleReset(onReset, 5_000));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(onReset).not.toHaveBeenCalled();
  });

  it('keydown event also resets the timer', () => {
    const onReset = vi.fn();
    renderHook(() => useIdleReset(onReset, 5_000));

    act(() => {
      vi.advanceTimersByTime(4_000);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });

    // After activity, the full window starts fresh.
    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(onReset).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onReset).toHaveBeenCalledOnce();
  });
});
