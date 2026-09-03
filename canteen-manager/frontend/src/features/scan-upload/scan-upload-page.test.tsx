import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ScanUploadPage } from './scan-upload-page';

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function scanFile(name: string, tail: number, png = false): File {
  const magic = png ? PNG_MAGIC : JPEG_MAGIC;
  return new File([magic, new Uint8Array([tail])], name, {
    type: png ? 'image/png' : 'image/jpeg',
  });
}

function jsonResponse(body: unknown, status = 202): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status >= 500 ? 'Service Unavailable' : undefined,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderPage() {
  const router = createMemoryRouter([
    { path: '/', element: <ScanUploadPage /> },
    { path: '/scan-monitor', element: <div>Scan Monitor</div> },
  ]);
  return render(<RouterProvider router={router} />);
}

function rowFor(filename: string): HTMLElement {
  const row = screen.getByText(filename).closest('li');
  if (!row) throw new Error(`Expected ${filename} to be rendered in a list item`);
  return row;
}

async function chooseFiles(files: File[]) {
  const input = screen.getByLabelText(/scanned form images/i);
  await userEvent.upload(input, files);
  return input;
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ScanUploadPage sequential production upload', () => {
  it('preserves selection order and allows exactly one POST /scans request in flight', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    const files = [
      scanFile('first.jpg', 1),
      scanFile('second.png', 2, true),
      scanFile('third.jpeg', 3),
    ];
    await chooseFiles(files);
    await userEvent.click(screen.getByRole('button', { name: /upload 3 scans/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/scans');
    expect(within(rowFor('first.jpg')).getByText(/uploading/i)).toBeInTheDocument();
    expect(within(rowFor('second.png')).getByText(/waiting/i)).toBeInTheDocument();

    first.resolve(jsonResponse({ id: 'one', sheetId: 'UPLOAD-1', status: 'pending' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(within(rowFor('first.jpg')).getByText(/accepted/i)).toBeInTheDocument();
    expect(within(rowFor('second.png')).getByText(/uploading/i)).toBeInTheDocument();

    second.resolve(jsonResponse({ id: 'two', sheetId: 'UPLOAD-2', status: 'pending' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(within(rowFor('third.jpeg')).getByText(/uploading/i)).toBeInTheDocument();

    third.resolve(jsonResponse({ id: 'three', sheetId: 'UPLOAD-3', status: 'pending' }));
    await waitFor(() => {
      expect(within(rowFor('third.jpeg')).getByText(/accepted/i)).toBeInTheDocument();
    });

    const payloads = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)) as {
        sheetId: string;
        checksum: string;
        imageBase64: string;
      },
    );
    const expectedChecksums = await Promise.all(files.map(async (file) => {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }));
    expect(payloads.map((payload) => payload.imageBase64)).toEqual([
      '/9j/4AE=',
      'iVBORw0KGgoC',
      '/9j/4AM=',
    ]);
    expect(payloads.map((payload) => payload.checksum)).toEqual(expectedChecksums);
    expect(new Set(payloads.map((payload) => payload.sheetId)).size).toBe(3);
    expect(payloads.every((payload) => payload.sheetId.length <= 100)).toBe(true);
    expect(payloads.every((payload) => !payload.imageBase64.startsWith('data:'))).toBe(true);
    expect(payloads.every((payload) => Object.keys(payload).sort().join(',') === 'batch,checksum,imageBase64,sheetId')).toBe(true);
    expect(payloads.every((payload) => !('capturedAt' in payload))).toBe(true);
    expect(payloads.every((payload) => !('admittedAt' in payload))).toBe(true);
    expect(payloads.every((payload) => !('deviceTimestamp' in payload))).toBe(true);
    expect(payloads.every((payload) => !('captureTime' in payload))).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/scans')).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/scans/demo'))).toBe(false);
  });

  it('isolates accepted, duplicate, and transient outcomes and retries only transient failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'accepted-1', sheetId: 'UPLOAD-A', status: 'pending' }))
      .mockResolvedValueOnce(jsonResponse({
        statusCode: 409,
        code: 'SHEET.DEDUP_CONFLICT',
        message: 'Duplicate scan: sheet already submitted',
        id: 'existing-42',
        sheetId: 'FORM-42',
        status: 'flagged',
      }, 409))
      .mockResolvedValueOnce(jsonResponse({
        statusCode: 503,
        code: 'OMR.SERVICE_UNAVAILABLE',
        message: 'OMR image preflight is unavailable',
      }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 'accepted-2', sheetId: 'UPLOAD-B', status: 'pending' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'retried', sheetId: 'UPLOAD-C', status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await chooseFiles([
      scanFile('accepted.jpg', 1),
      scanFile('duplicate.jpg', 2),
      scanFile('service-down.jpg', 3),
      scanFile('still-runs.jpg', 4),
    ]);
    await userEvent.click(screen.getByRole('button', { name: /upload 4 scans/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(within(rowFor('accepted.jpg')).getByText(/^accepted$/i)).toBeInTheDocument();
    const duplicateRow = within(rowFor('duplicate.jpg'));
    expect(duplicateRow.getByText(/^duplicate$/i)).toBeInTheDocument();
    expect(duplicateRow.getByText(/already submitted as FORM-42/i)).toBeInTheDocument();
    expect(duplicateRow.getByRole('link', { name: /scan monitor/i })).toHaveAttribute(
      'href',
      '/scan-monitor?sheet=existing-42',
    );
    expect(within(rowFor('service-down.jpg')).getByText(/failed/i)).toBeInTheDocument();
    expect(within(rowFor('still-runs.jpg')).getByText(/accepted/i)).toBeInTheDocument();

    const retryButtons = screen.getAllByRole('button', { name: /retry/i });
    expect(retryButtons).toHaveLength(1);
    expect(retryButtons[0]).toHaveAccessibleName(/service-down\.jpg/i);
    expect(within(rowFor('duplicate.jpg')).queryByRole('button', { name: /retry/i })).toBeNull();

    await userEvent.click(retryButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    await waitFor(() => {
      expect(within(rowFor('service-down.jpg')).getByText(/accepted/i)).toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.slice(4).every(([url]) => url === '/api/scans')).toBe(true);
  });

  it('does not offer retry for a terminal client or validation failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      statusCode: 400,
      code: 'SCAN.INVALID_IMAGE',
      message: 'Image cannot be decoded',
    }, 400));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await chooseFiles([scanFile('invalid.jpg', 8)]);
    await userEvent.click(screen.getByRole('button', { name: /upload 1 scan/i }));

    await waitFor(() => {
      expect(within(rowFor('invalid.jpg')).getByText(/failed/i)).toBeInTheDocument();
    });
    expect(within(rowFor('invalid.jpg')).queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('guards rapid double-start so each selected file is submitted once', async () => {
    const first = deferred<Response>();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(jsonResponse({ id: 'two', sheetId: 'UPLOAD-2', status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();

    await chooseFiles([scanFile('one.jpg', 1), scanFile('two.jpg', 2)]);
    const start = screen.getByRole('button', { name: /upload 2 scans/i });
    fireEvent.click(start);
    fireEvent.click(start);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.resolve(jsonResponse({ id: 'one', sheetId: 'UPLOAD-1', status: 'pending' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(rowFor('two.jpg')).getByText(/accepted/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears the native input so the same file can be selected again', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>());
    renderPage();
    const file = scanFile('rescan.jpg', 7);

    const input = await chooseFiles([file]);
    expect(input).toHaveValue('');
    await userEvent.upload(input, file);

    expect(screen.getAllByText('rescan.jpg')).toHaveLength(2);
    expect(input).toHaveValue('');
  });
});
