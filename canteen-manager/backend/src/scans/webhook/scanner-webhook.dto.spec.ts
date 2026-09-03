import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  parseScannerCallback,
  SCANNER_CALLBACK_MAX_ARTIFACTS,
  SCANNER_CALLBACK_EVENT_TYPE,
  SCANNER_CALLBACK_SCHEMA_VERSION,
} from './scanner-webhook.dto';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt_test',
    event_type: SCANNER_CALLBACK_EVENT_TYPE,
    idempotency_key: 'order-scanner/v1/doc_test/1',
    occurred_at: '2026-08-06T00:00:00Z',
    schema_version: SCANNER_CALLBACK_SCHEMA_VERSION,
    result: {
      result_id: 'res_test',
      document_id: 'doc_test',
      page_index: 0,
      revision: 1,
      service_date: '2026-08-06',
      outcome: 'needs_review',
      artifacts: [],
      items: [],
      versions: { callback_schema: SCANNER_CALLBACK_SCHEMA_VERSION },
    },
    ...overrides,
  };
}

describe('scanner callback payload contract', () => {
  it('parses the generated callback shape without changing the raw bytes', () => {
    const raw = Buffer.from(JSON.stringify(payload()));
    expect(parseScannerCallback(raw, 1024)).toMatchObject({ event_id: 'evt_test' });
    expect(raw.toString('utf8')).toContain('order-scanner/v1/doc_test/1');
  });

  it('rejects unsupported schemas and malformed dates', () => {
    expect(() => parseScannerCallback(Buffer.from(JSON.stringify(payload({ schema_version: '2.0' }))), 1024)).toThrow(BadRequestException);
    expect(() => parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      result: { ...(payload().result as object), service_date: '2026-02-30' },
    })), 1024)).toThrow(BadRequestException);
    expect(() => parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      occurred_at: '2026-02-30T00:00:00Z',
    })), 1024)).toThrow(BadRequestException);
    expect(() => parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      occurred_at: '2026-08-06T00:00:00+07:00',
    })), 1024)).toThrow(BadRequestException);
  });

  it('rejects duplicate artifact IDs and oversized bodies', () => {
    const result = payload().result as Record<string, unknown>;
    const artifact = {
      artifact_id: 'crop-1',
      kind: 'crop',
      media_type: 'image/png',
      sha256: 'a'.repeat(64),
      url: 'https://scanner.example.test/artifacts/crop-1',
    };
    const duplicate = Buffer.from(JSON.stringify({
      ...payload(),
      result: { ...result, artifacts: [artifact, artifact] },
    }));
    expect(() => parseScannerCallback(duplicate, 1024 * 1024)).toThrow(BadRequestException);
    expect(() => parseScannerCallback(Buffer.from(JSON.stringify(payload())), 4)).toThrow(PayloadTooLargeException);
  });

  it('accepts the full ticket-v4 review artifact set and rejects overflow', () => {
    const result = payload().result as Record<string, unknown>;
    expect(SCANNER_CALLBACK_MAX_ARTIFACTS).toBe(35);
    const artifacts = Array.from({ length: 35 }, (_, index) => ({
      artifact_id: `artifact-${index}`,
      kind: index === 0 ? 'source' : 'review-crop',
      media_type: index === 0 ? 'application/pdf' : 'image/png',
      sha256: String(index).padStart(64, 'a'),
      url: `https://scanner.example.test/artifacts/artifact-${index}`,
    }));
    expect(parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      result: { ...result, artifacts },
    })), 1024 * 1024)).toMatchObject({ event_id: 'evt_test' });

    expect(() => parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      result: { ...result, artifacts: [...artifacts, { ...artifacts[0], artifact_id: 'artifact-overflow' }] },
    })), 1024 * 1024)).toThrow(BadRequestException);
  });

  it('accepts contract artifact IDs containing path separators', () => {
    const result = payload().result as Record<string, unknown>;
    const artifact = {
      artifact_id: 'source/page-0',
      kind: 'source',
      media_type: 'image/png',
      sha256: 'a'.repeat(64),
      url: 'https://scanner.example.test/artifacts/source%2Fpage-0',
    };
    expect(parseScannerCallback(Buffer.from(JSON.stringify({
      ...payload(),
      result: { ...result, artifacts: [artifact] },
    })), 1024 * 1024)).toMatchObject({ event_id: 'evt_test' });
  });
});
