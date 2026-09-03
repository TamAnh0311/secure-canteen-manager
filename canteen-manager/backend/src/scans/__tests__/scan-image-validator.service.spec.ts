import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { ScanImageValidatorService } from '../scan-image-validator.service';

const REAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAAEAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABgQAQEAAwAAAAAAAAAAAAAAAAECACEx/9oACAEBAAA/AFR1IEyAHM//2Q==',
  'base64',
);

const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function responseCode(error: unknown): string | undefined {
  if (!(error instanceof BadRequestException)) return undefined;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null
    ? (response as { code?: string }).code
    : undefined;
}

describe('ScanImageValidatorService', () => {
  const validator = new ScanImageValidatorService();

  it.each([
    ['jpeg', REAL_JPEG, '.jpg', 4, 4],
    ['png', REAL_PNG, '.png', 1, 1],
  ] as const)(
    'accepts canonical real %s bytes with an exact SHA-256 and reports the authoritative format',
    (format, bytes, extension, width, height) => {
      const result = validator.validate({
        imageBase64: bytes.toString('base64'),
        checksum: sha256(bytes),
      });

      expect(result).toEqual({ bytes, format, extension, width, height });
    },
  );

  it.each([
    ['empty', ''],
    ['data URL', `data:image/png;base64,${REAL_PNG.toString('base64')}`],
    ['embedded whitespace', `${REAL_PNG.toString('base64').slice(0, 8)}\n${REAL_PNG.toString('base64').slice(8)}`],
    ['missing required padding', REAL_JPEG.toString('base64').replace(/=+$/, '')],
    ['non-base64 alphabet', '%%%not-base64%%%'],
  ])('rejects %s input instead of normalizing it', (_label, imageBase64) => {
    let error: unknown;
    try {
      validator.validate({ imageBase64, checksum: '0'.repeat(64) });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BadRequestException);
    expect(responseCode(error)).toBe('SCAN.IMAGE_BASE64_INVALID');
  });

  it('accepts the 10 MiB decoded boundary and rejects one byte above it before parsing', () => {
    // JPEG decoders allow bytes after EOI, so the exact-boundary fixture remains a
    // real decodable JPEG while exercising the decoded-byte limit.
    const atLimit = Buffer.concat([
      REAL_JPEG,
      Buffer.alloc(10 * 1024 * 1024 - REAL_JPEG.length),
    ]);
    expect(
      validator.validate({
        imageBase64: atLimit.toString('base64'),
        checksum: sha256(atLimit),
      }).format,
    ).toBe('jpeg');

    const aboveLimit = Buffer.concat([atLimit, Buffer.from([0])]);
    expect(() =>
      validator.validate({
        imageBase64: aboveLimit.toString('base64'),
        checksum: sha256(aboveLimit),
      }),
    ).toThrow(PayloadTooLargeException);
  });

  it('rejects a checksum that does not match the decoded bytes', () => {
    expect(() =>
      validator.validate({
        imageBase64: REAL_PNG.toString('base64'),
        checksum: '0'.repeat(64),
      }),
    ).toThrow(BadRequestException);

    try {
      validator.validate({
        imageBase64: REAL_PNG.toString('base64'),
        checksum: '0'.repeat(64),
      });
    } catch (error) {
      expect(responseCode(error)).toBe('SCAN.CHECKSUM_MISMATCH');
    }
  });

  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n')],
    ['GIF', Buffer.from('GIF89a')],
    ['TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
  ])('rejects %s magic even when the hash is correct', (_label, bytes) => {
    expect(() =>
      validator.validate({
        imageBase64: bytes.toString('base64'),
        checksum: sha256(bytes),
      }),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('rejects a truncated PNG header with no dimensions', () => {
    const truncated = REAL_PNG.subarray(0, 16);
    expect(() =>
      validator.validate({
        imageBase64: truncated.toString('base64'),
        checksum: sha256(truncated),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects impossible PNG dimensions before storage', () => {
    const impossible = Buffer.from(REAL_PNG);
    impossible.writeUInt32BE(100_000, 16);
    impossible.writeUInt32BE(100_000, 20);

    expect(() =>
      validator.validate({
        imageBase64: impossible.toString('base64'),
        checksum: sha256(impossible),
      }),
    ).toThrow(BadRequestException);
  });
});
