import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SCAN_BYTES,
  bytesToBase64,
  scanUploadReducer,
  sha256Hex,
  validateScanFile,
  validateScanMagic,
  type ScanUploadItem,
} from './scan-upload-model';

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function scanFile(
  name: string,
  bytes: BlobPart[],
  type: 'image/jpeg' | 'image/png' = 'image/jpeg',
): File {
  return new File(bytes, name, { type });
}

function waitingItem(key: string, name = `${key}.jpg`): ScanUploadItem {
  const file = scanFile(name, [JPEG_MAGIC]);
  return {
    key,
    name,
    size: file.size,
    file,
    status: 'waiting',
  };
}

describe('scan upload file preflight', () => {
  it('accepts an image at exactly 10 MiB', async () => {
    const file = scanFile('limit.jpg', [
      JPEG_MAGIC,
      new Uint8Array(MAX_SCAN_BYTES - JPEG_MAGIC.byteLength),
    ]);

    expect(validateScanFile(file)).toBeNull();
  });

  it('rejects one byte over 10 MiB without reading the file', async () => {
    const file = scanFile('too-large.jpg', [
      JPEG_MAGIC,
      new Uint8Array(MAX_SCAN_BYTES + 1 - JPEG_MAGIC.byteLength),
    ]);
    const read = vi.spyOn(file, 'arrayBuffer');

    expect(validateScanFile(file)).toBe('too-large');
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an empty file without reading it', async () => {
    const file = scanFile('empty.png', [], 'image/png');
    const read = vi.spyOn(file, 'arrayBuffer');

    expect(validateScanFile(file)).toBe('empty');
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ['PDF', 'paper.pdf', 'application/pdf'],
    ['TIFF', 'paper.tiff', 'image/tiff'],
    ['GIF', 'paper.gif', 'image/gif'],
  ])('rejects unsupported %s metadata before reading bytes', async (_label, name, type) => {
    const file = new File([JPEG_MAGIC], name, { type });
    const read = vi.spyOn(file, 'arrayBuffer');

    expect(validateScanFile(file)).toBe('unsupported');
    expect(read).not.toHaveBeenCalled();
  });

  it('accepts JPEG and PNG magic hints when metadata also matches', async () => {
    const jpeg = scanFile('photo.jpeg', [JPEG_MAGIC]);
    const png = scanFile('photo.png', [PNG_MAGIC], 'image/png');

    expect(validateScanFile(jpeg)).toBeNull();
    expect(validateScanFile(png)).toBeNull();
    await expect(validateScanMagic(jpeg)).resolves.toBe('jpeg');
    await expect(validateScanMagic(png)).resolves.toBe('png');
  });

  it('rejects renamed bytes that do not have JPEG or PNG magic', async () => {
    const renamedPdf = scanFile(
      'renamed.jpg',
      [new TextEncoder().encode('%PDF-1.7')],
    );

    expect(validateScanFile(renamedPdf)).toBeNull();
    await expect(validateScanMagic(renamedPdf)).resolves.toBeNull();
  });
});

describe('scan upload byte contracts', () => {
  it('computes the lowercase SHA-256 of the real raw bytes with Web Crypto', async () => {
    const bytes = new TextEncoder().encode('abc');

    await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('encodes exact prefix-free base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = bytesToBase64(bytes.buffer as ArrayBuffer);

    expect(encoded).toBe('AAEC/f7/');
    expect(encoded).not.toMatch(/^data:/);
  });

  it('encodes a large byte array without spreading it onto the call stack', () => {
    const bytes = new Uint8Array(256 * 1024);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251;
    }

    const encoded = bytesToBase64(bytes.buffer as ArrayBuffer);

    expect(encoded).toHaveLength(349_528);
    expect(encoded.slice(0, 12)).toBe('AAECAwQFBgcI');
    expect(encoded).not.toMatch(/^data:/);
  });
});

describe('scan upload item transitions', () => {
  it('updates only the addressed file through waiting, uploading, and accepted', () => {
    const first = waitingItem('first');
    const second = waitingItem('second');
    const uploading = scanUploadReducer([first, second], { type: 'uploading', key: first.key });

    expect(uploading.map((item) => item.status)).toEqual(['uploading', 'waiting']);

    const accepted = scanUploadReducer(uploading, {
      type: 'accepted',
      key: first.key,
      result: { id: 'server-1', sheetId: 'UPLOAD-1', status: 'pending' },
    });

    expect(accepted[0]).toMatchObject({
      status: 'accepted',
      result: { id: 'server-1', sheetId: 'UPLOAD-1', status: 'pending' },
    });
    expect(accepted[1]).toBe(second);
  });

  it('keeps duplicate terminal metadata distinct from a retryable failure', () => {
    const duplicate = scanUploadReducer([waitingItem('duplicate')], {
      type: 'duplicate',
      key: 'duplicate',
      result: { id: 'existing-1', sheetId: 'FORM-42', status: 'flagged' },
      error: 'Already uploaded',
    });
    const transient = scanUploadReducer([waitingItem('transient')], {
      type: 'failed',
      key: 'transient',
      error: 'Service unavailable',
      retryable: true,
    });

    expect(duplicate[0]).toMatchObject({
      status: 'duplicate',
      result: { id: 'existing-1', sheetId: 'FORM-42', status: 'flagged' },
    });
    expect(duplicate[0].retryable).not.toBe(true);
    expect(transient[0]).toMatchObject({
      status: 'failed',
      error: 'Service unavailable',
      retryable: true,
    });
    expect(transient[0].file).toBeInstanceOf(File);

    const permanent = scanUploadReducer([waitingItem('permanent')], {
      type: 'failed',
      key: 'permanent',
      error: 'Invalid image',
      retryable: false,
    });
    expect(permanent[0].file).toBeUndefined();
  });
});
