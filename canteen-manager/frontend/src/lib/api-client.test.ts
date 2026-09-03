import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { translateApiError } from './api-client';
import { confirmScan } from './api/scans';

// Default language is Vietnamese; assertions use the VI strings from the
// `errors` namespace. Reset to VI before each test in case another suite
// switched the active language.
describe('translateApiError', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('vi');
  });

  it('translates a known domain code to its VI message', () => {
    const msg = translateApiError(
      { code: 'AUTH.INVALID_CREDENTIALS', message: 'Invalid credentials' },
      'fallback',
    );
    expect(msg).toBe('Thông tin đăng nhập không đúng');
  });

  it('falls back to the raw message for an unknown code', () => {
    const msg = translateApiError(
      { code: 'WEIRD.UNMAPPED', message: 'Something specific broke' },
      'fallback',
    );
    expect(msg).toBe('Something specific broke');
  });

  it('translates and joins a validation message array', () => {
    const msg = translateApiError(
      { message: ['VALIDATION.PASSWORD_MIN', 'VALIDATION.USERNAME_REQUIRED'] },
      'fallback',
    );
    expect(msg).toBe(
      'Mật khẩu phải có ít nhất 8 ký tự, Vui lòng nhập tên đăng nhập',
    );
  });

  it('leaves an unmapped plain-string message unchanged', () => {
    const msg = translateApiError({ message: 'Some upstream text' }, 'fallback');
    expect(msg).toBe('Some upstream text');
  });

  it('returns a raw string body as-is', () => {
    expect(translateApiError('plain text body', 'fallback')).toBe('plain text body');
  });

  it('uses the fallback when the body has no usable message', () => {
    expect(translateApiError({}, 'HTTP 500')).toBe('HTTP 500');
    expect(translateApiError(null, 'HTTP 500')).toBe('HTTP 500');
  });

  it('uses the fallback for an empty validation array (never blank)', () => {
    expect(translateApiError({ message: [] }, 'HTTP 400')).toBe('HTTP 400');
  });

  it('honors the active language (EN)', async () => {
    await i18n.changeLanguage('en');
    const msg = translateApiError(
      { code: 'USER.NOT_FOUND', message: 'raw fallback' },
      'fallback',
    );
    expect(msg).toBe('User not found');
    await i18n.changeLanguage('vi');
  });

  it('interpolates the structured category-limit amounts from the authoritative response', () => {
    expect(translateApiError({
      code: 'ORDER.CATEGORY_LIMIT_EXCEEDED',
      message: 'raw fallback',
      audience: 'prisoner',
      category: 'food',
      actualAmount: 120000,
      limitAmount: 100000,
    }, 'fallback')).toBe('Tổng food 120000 vượt giới hạn 100000.');
  });

  it('localizes the consumed-form terminal conflict with reprint guidance', async () => {
    expect(
      translateApiError(
        {
          code: 'OMR_FORM.ALREADY_CONSUMED',
          message: 'Issued form can no longer be confirmed; reprint is required',
        },
        'fallback',
      ),
    ).toBe('Phiếu này đã được sử dụng. Hãy in lại phiếu trước khi quét lại.');

    await i18n.changeLanguage('en');
    expect(
      translateApiError(
        {
          code: 'OMR_FORM.ALREADY_CONSUMED',
          message: 'Issued form can no longer be confirmed; reprint is required',
        },
        'fallback',
      ),
    ).toBe('This form has already been used. Reprint the form before scanning again.');
  });
});

describe('confirmScan — items-only wire contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serializes exactly {items}, even if a stale caller still supplies identity fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ replaced: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const items = [{ menuItemId: 'menu-1', quantity: 2 }];

    const result = await confirmScan(
      'sheet-1',
      { items, userId: 'attacker', idDigits: 'P-ATTACKER' } as never,
    );

    expect(result).toEqual({ replaced: false });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ items });
  });
});
