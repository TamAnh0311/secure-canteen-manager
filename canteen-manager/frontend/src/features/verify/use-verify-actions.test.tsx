import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { scans } from '@/lib/api';
import type { QueueSheetItem } from '@/lib/types';
import { useVerifyActions } from './use-verify-actions';
import { ApiError } from '@/lib/api-client';

vi.mock('@/lib/api', () => ({ scans: {
  confirmScan: vi.fn(),
  confirmGenericScan: vi.fn(),
  rejectScan: vi.fn(),
  skipScan: vi.fn(),
} }));

const current = {
  id: 'sheet-1', sheetId: 'S1', status: 'flagged', avgConfidence: 1,
  identity: { id: 'u1', legacyId: 'P1', name: 'A', zone: null, cell: null },
  balance: 1000, form: { serial: 'F1', revision: 'v3', serviceDate: '2026-07-15' },
  orderLines: [], existingOrder: null, flags: [], warpedImageUrl: '/image',
  source: 'omr', scannerEvidence: null,
  bindingKind: 'issued', identityEvidence: [], rankedCandidates: [],
} satisfies QueueSheetItem;

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useVerifyActions category guard', () => {
  it('blocks before API execution when the rollout mode disables confirmation', async () => {
    const { result } = renderHook(() => useVerifyActions({
      current,
      draft: { dirty: false, lines: [] },
      identityReady: true,
      confirmationEnabled: false,
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: false,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance: vi.fn(),
      skipForward: vi.fn(),
      requestSupersedeAck: vi.fn(async () => true),
    }), { wrapper });

    await act(() => result.current.confirm());
    expect(scans.confirmScan).not.toHaveBeenCalled();
    expect(scans.confirmGenericScan).not.toHaveBeenCalled();
  });

  it('blocks before acknowledgement and API execution', async () => {
    const ack = vi.fn(async () => true);
    const { result } = renderHook(() => useVerifyActions({
      current,
      draft: { dirty: false, lines: [] },
      identityReady: true,
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: true,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance: vi.fn(),
      skipForward: vi.fn(),
      requestSupersedeAck: ack,
    }), { wrapper });

    await act(() => result.current.confirm());
    expect(ack).not.toHaveBeenCalled();
    expect(scans.confirmScan).not.toHaveBeenCalled();
  });

  it('keeps the sheet and forwards the exact structured rejection for persistent recovery UI', async () => {
    const rejected = new ApiError(400, 'Food subtotal 15000 exceeds the 10000 limit.', {
      code: 'ORDER.CATEGORY_LIMIT_EXCEEDED', category: 'food', actualAmount: 15000, limitAmount: 10000,
    });
    vi.mocked(scans.confirmScan).mockRejectedValueOnce(rejected);
    const onRejected = vi.fn();
    const advance = vi.fn();
    const { result } = renderHook(() => useVerifyActions({
      current,
      draft: { dirty: true, lines: [{ lineIndex: 0, mappingAuthority: 'code', codeInput: '001', resolvedItem: { menuItemId: 'm1', name: 'Food', unitPrice: 15000, inactive: false, category: 'food' }, quantity: 1, flags: [], lowConfidence: false, edited: true }] },
      identityReady: true,
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: false,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance,
      skipForward: vi.fn(),
      requestSupersedeAck: vi.fn(async () => true),
      onCategoryLimitRejected: onRejected,
    }), { wrapper });

    await act(() => result.current.confirm());
    expect(onRejected).toHaveBeenCalledWith(rejected);
    expect(advance).not.toHaveBeenCalled();
  });
});

describe('useVerifyActions generic identity contract', () => {
  it('sends only the explicit user, authoritative items, acknowledgement, and bounded reason', async () => {
    vi.mocked(scans.confirmGenericScan).mockResolvedValueOnce({ replaced: true });
    const ack = vi.fn(async () => true);
    const genericCurrent: QueueSheetItem = {
      ...current,
      bindingKind: 'generic',
      identity: null,
      balance: null,
      existingOrder: null,
      identityEvidence: [],
      rankedCandidates: [],
    };
    const { result } = renderHook(() => useVerifyActions({
      current: genericCurrent,
      draft: {
        dirty: true,
        lines: [{
          lineIndex: 0,
          mappingAuthority: 'code',
          codeInput: '001',
          resolvedItem: {
            menuItemId: '22222222-2222-4222-8222-222222222222',
            name: 'Food',
            unitPrice: 15_000,
            inactive: false,
            category: 'food',
          },
          quantity: 2,
          flags: [],
          lowConfidence: false,
          edited: true,
        }],
      },
      identityReady: true,
      identityBlockReason: null,
      selectedUserId: '11111111-1111-4111-8111-111111111111',
      identityReason: 'Manual directory match confirmed against the handwriting.',
      existingOrder: { items: [], total: 20_000 },
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: false,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance: vi.fn(),
      skipForward: vi.fn(),
      requestSupersedeAck: ack,
    }), { wrapper });

    await act(() => result.current.confirm());

    expect(ack).toHaveBeenCalledOnce();
    expect(scans.confirmGenericScan).toHaveBeenCalledWith('sheet-1', {
      userId: '11111111-1111-4111-8111-111111111111',
      items: [{ menuItemId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
      replacementAck: true,
      reason: 'Manual directory match confirmed against the handwriting.',
    });
  });

  it('sends scanner confirmation through the explicit identity contract', async () => {
    vi.mocked(scans.confirmGenericScan).mockResolvedValueOnce({ replaced: false });
    const scannerCurrent: QueueSheetItem = {
      ...current,
      source: 'scanner',
      bindingKind: 'scanner',
      identity: null,
      warpedImageUrl: null,
      scannerEvidence: {
        outcome: 'accepted',
        resultId: 'result-1',
        documentId: 'document-1',
        revision: 1,
        warnings: [],
        artifacts: [],
        items: [],
        requiresIdentityReason: false,
        catalogueDrift: false,
        reviewState: 'ready',
        blockers: [],
      },
    };
    const { result } = renderHook(() => useVerifyActions({
      current: scannerCurrent,
      draft: {
        dirty: false,
        lines: [{
          lineIndex: 0,
          mappingAuthority: 'code',
          codeInput: '001',
          resolvedItem: {
            menuItemId: '22222222-2222-4222-8222-222222222222',
            name: 'Food',
            unitPrice: 15_000,
            inactive: false,
            category: 'food',
          },
          quantity: 1,
          flags: [],
          lowConfidence: false,
          edited: false,
        }],
      },
      identityReady: true,
      selectedUserId: '11111111-1111-4111-8111-111111111111',
      identityReason: 'Reviewed the scanner item and quantity warnings.',
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: false,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance: vi.fn(),
      skipForward: vi.fn(),
      requestSupersedeAck: vi.fn(async () => true),
    }), { wrapper });

    await act(() => result.current.confirm());

    expect(scans.confirmGenericScan).toHaveBeenCalledWith('sheet-1', {
      userId: '11111111-1111-4111-8111-111111111111',
      items: [{ menuItemId: '22222222-2222-4222-8222-222222222222', quantity: 1 }],
      replacementAck: undefined,
      reason: 'Reviewed the scanner item and quantity warnings.',
    });
  });
});

describe('useVerifyActions issued replacement acknowledgement', () => {
  it('forwards acknowledgement for an issued OMR replacement', async () => {
    vi.mocked(scans.confirmScan).mockResolvedValueOnce({ replaced: true });
    const { result } = renderHook(() => useVerifyActions({
      current,
      draft: {
        dirty: false,
        lines: [{
          lineIndex: 0,
          mappingAuthority: 'code',
          codeInput: '001',
          resolvedItem: { menuItemId: 'm1', name: 'Food', unitPrice: 10_000, inactive: false, category: 'food' },
          quantity: 1,
          flags: [],
          lowConfidence: false,
          edited: false,
        }],
      },
      identityReady: true,
      existingOrder: { items: [], total: 10_000 },
      blockedNoSelection: false,
      blockedUnresolvedLine: false,
      blockedCategoryLimit: false,
      unresolved: 0,
      focusUnresolved: vi.fn(),
      advance: vi.fn(),
      skipForward: vi.fn(),
      requestSupersedeAck: vi.fn(async () => true),
    }), { wrapper });

    await act(() => result.current.confirm());

    expect(scans.confirmScan).toHaveBeenCalledWith('sheet-1', {
      items: [{ menuItemId: 'm1', quantity: 1 }],
      replacementAck: true,
    });
  });
});
