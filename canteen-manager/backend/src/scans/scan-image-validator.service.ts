import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'crypto';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50_000_000;

export type ScanImageFormat = 'jpeg' | 'png';

export interface ValidatedScanImage {
  bytes: Buffer;
  format: ScanImageFormat;
  extension: '.jpg' | '.png';
  width: number;
  height: number;
}

@Injectable()
export class ScanImageValidatorService {
  validate(input: { imageBase64: string; checksum: string }): ValidatedScanImage {
    const { imageBase64 } = input;
    const paddingLength = imageBase64.endsWith('==') ? 2 : imageBase64.endsWith('=') ? 1 : 0;
    const alphabet = paddingLength > 0 ? imageBase64.slice(0, -paddingLength) : imageBase64;
    if (!imageBase64 || imageBase64.length % 4 !== 0 || /[^A-Za-z0-9+/]/.test(alphabet)) {
      throw new BadRequestException({ message: 'Image must be canonical base64', code: 'SCAN.IMAGE_BASE64_INVALID' });
    }

    const bytes = Buffer.from(imageBase64, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== imageBase64) {
      throw new BadRequestException({ message: 'Image must be canonical base64', code: 'SCAN.IMAGE_BASE64_INVALID' });
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException({ message: 'Image exceeds the 10 MiB limit', code: 'SCAN.IMAGE_TOO_LARGE' });
    }

    const actualChecksum = createHash('sha256').update(bytes).digest('hex');
    if (actualChecksum !== input.checksum) {
      throw new BadRequestException({ message: 'Checksum does not match image bytes', code: 'SCAN.CHECKSUM_MISMATCH' });
    }

    const detected = this.detect(bytes);
    if (detected.width <= 0 || detected.height <= 0 || detected.width * detected.height > MAX_IMAGE_PIXELS) {
      throw new BadRequestException({ message: 'Image dimensions are invalid or too large', code: 'SCAN.IMAGE_DIMENSIONS_INVALID' });
    }
    return { bytes, ...detected };
  }

  private detect(bytes: Buffer): Omit<ValidatedScanImage, 'bytes'> {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      if (bytes.length < 24) {
        throw new BadRequestException({ message: 'PNG header is truncated', code: 'SCAN.IMAGE_HEADER_INVALID' });
      }
      if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
        throw new BadRequestException({ message: 'PNG header is invalid', code: 'SCAN.IMAGE_HEADER_INVALID' });
      }
      return { format: 'png', extension: '.png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }

    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let offset = 2;
      while (offset + 3 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
        if (offset + 2 > bytes.length) break;
        const length = bytes.readUInt16BE(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          if (length < 7) break;
          return {
            format: 'jpeg',
            extension: '.jpg',
            height: bytes.readUInt16BE(offset + 3),
            width: bytes.readUInt16BE(offset + 5),
          };
        }
        offset += length;
      }
      throw new BadRequestException({ message: 'JPEG header has no valid dimensions', code: 'SCAN.IMAGE_HEADER_INVALID' });
    }

    throw new UnsupportedMediaTypeException({ message: 'Only JPEG and PNG images are accepted', code: 'SCAN.IMAGE_TYPE_UNSUPPORTED' });
  }
}
