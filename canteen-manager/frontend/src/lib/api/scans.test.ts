import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmGenericScan, submitScan } from './scans';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scan API wire contracts', () => {
  it('serializes browser uploads without capture, admission, or device timestamps', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ id: 'sheet-id', sheetId: 'WEB-1', status: 'pending' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitScan({
      sheetId: 'WEB-1',
      batch: 'browser-upload',
      checksum: 'a'.repeat(64),
      imageBase64: '/9j/',
      capturedAt: '2099-01-01T00:00:00.000Z',
      admittedAt: '2099-01-01T00:00:00.000Z',
      deviceTimestamp: 4_070_908_800_000,
    } as Parameters<typeof submitScan>[0] & Record<string, unknown>);

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toEqual({
      sheetId: 'WEB-1',
      batch: 'browser-upload',
      checksum: 'a'.repeat(64),
      imageBase64: '/9j/',
    });
  });

  it('serializes generic confirmation authority from the strict allowlist only', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ replaced: false }));
    vi.stubGlobal('fetch', fetchMock);

    await confirmGenericScan('sheet-id', {
      userId: '11111111-1111-4111-8111-111111111111',
      items: [{ menuItemId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
      replacementAck: true,
      reason: 'The written ID matches the manual directory record.',
      rank: 1,
      score: 0.99,
      ocrName: 'Untrusted OCR text',
      zone: 'Untrusted zone',
      balance: 999_999_999,
    } as Parameters<typeof confirmGenericScan>[1] & Record<string, unknown>);

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(payload).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      items: [{ menuItemId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
      replacementAck: true,
      reason: 'The written ID matches the manual directory record.',
    });
  });
});
