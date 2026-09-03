import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VERIFY_VIEW_MODE_STORAGE_KEY,
  readVerifyViewMode,
  useVerifyViewMode,
} from './use-verify-view-mode';

describe('useVerifyViewMode', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to guided and persists an explicit mode', () => {
    const { result } = renderHook(() => useVerifyViewMode());
    expect(result.current.mode).toBe('guided');
    act(() => result.current.setMode('detailed'));
    expect(result.current.mode).toBe('detailed');
    expect(localStorage.getItem(VERIFY_VIEW_MODE_STORAGE_KEY)).toBe('detailed');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(VERIFY_VIEW_MODE_STORAGE_KEY, 'full');
    expect(readVerifyViewMode()).toBe('guided');
  });

  it('recovers when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    expect(readVerifyViewMode()).toBe('guided');
  });
});
