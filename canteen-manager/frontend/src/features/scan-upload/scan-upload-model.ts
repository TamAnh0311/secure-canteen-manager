import type { SubmitScanResult } from '@/lib/types';

export const MAX_SCAN_BYTES = 10 * 1024 * 1024;
const BASE64_CHUNK_BYTES = 32 * 1024;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type ScanFileStatus = 'waiting' | 'uploading' | 'accepted' | 'duplicate' | 'failed';

export interface ScanUploadItem {
  key: string;
  name: string;
  size: number;
  file?: File;
  status: ScanFileStatus;
  error?: string;
  retryable?: boolean;
  result?: SubmitScanResult;
}

export type ScanUploadAction =
  | { type: 'add'; items: ScanUploadItem[] }
  | { type: 'remove'; key: string }
  | { type: 'uploading'; key: string }
  | { type: 'accepted'; key: string; result: SubmitScanResult }
  | { type: 'duplicate'; key: string; result: SubmitScanResult; error: string }
  | { type: 'failed'; key: string; error: string; retryable: boolean }
  | { type: 'retry'; key: string };

export function scanUploadReducer(state: ScanUploadItem[], action: ScanUploadAction): ScanUploadItem[] {
  if (action.type === 'add') return [...state, ...action.items];
  if (action.type === 'remove') {
    return state.filter((item) => item.key !== action.key || item.status === 'uploading');
  }
  return state.map((item) => {
    if (item.key !== action.key) return item;
    switch (action.type) {
      case 'uploading':
        return item.status === 'waiting'
          ? { ...item, status: 'uploading', error: undefined, retryable: false }
          : item;
      case 'accepted':
        return { ...item, file: undefined, status: 'accepted', result: action.result, error: undefined, retryable: false };
      case 'duplicate':
        return { ...item, file: undefined, status: 'duplicate', result: action.result, error: action.error, retryable: false };
      case 'failed':
        return {
          ...item,
          file: action.retryable ? item.file : undefined,
          status: 'failed',
          error: action.error,
          retryable: action.retryable,
        };
      case 'retry':
        return item.status === 'failed' && item.retryable && item.file
          ? { ...item, status: 'waiting', error: undefined, retryable: false }
          : item;
      default:
        return item;
    }
  });
}

export function validateScanFile(file: File): string | null {
  if (file.size === 0) return 'empty';
  if (file.size > MAX_SCAN_BYTES) return 'too-large';
  const name = file.name.toLowerCase();
  const extensionOk = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
  const mimeOk = file.type === 'image/jpeg' || file.type === 'image/png' || file.type === '';
  if (!extensionOk || !mimeOk) return 'unsupported';
  return null;
}

export async function validateScanMagic(file: File): Promise<'jpeg' | 'png' | null> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (startsWith(bytes, JPEG_MAGIC)) return 'jpeg';
  if (startsWith(bytes, PNG_MAGIC)) return 'png';
  return null;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + BASE64_CHUNK_BYTES, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function createUploadItems(files: File[], existingCount = 0): ScanUploadItem[] {
  return files.map((file, index) => ({
    key: `${Date.now()}-${existingCount + index}-${file.size}`,
    name: file.name,
    size: file.size,
    file,
    status: 'waiting',
  }));
}

export function makeSheetId(checksum: string, sequence: number): string {
  return `WEB-${Date.now().toString(36).toUpperCase()}-${String(sequence + 1).padStart(3, '0')}-${checksum.slice(0, 12)}`;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}
