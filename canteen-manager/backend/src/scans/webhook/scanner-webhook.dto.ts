import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const SCANNER_CALLBACK_SCHEMA_VERSION = '1.0-draft';
export const SCANNER_CALLBACK_EVENT_TYPE = 'order_scan.result';
// ticket-v4 emits one source artifact plus six ID cells, four room cells, and
// two review crops for each of the twelve order rows.
export const SCANNER_CALLBACK_MAX_ARTIFACTS = 35;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/;
const LONG_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,254}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SERVICE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/;

export interface ScannerArtifactReference {
  artifact_id: string;
  kind: string;
  media_type: string;
  sha256: string;
  url: string;
  field_id?: string | null;
  row_index?: number | null;
}

export interface ScannerCallbackPayload {
  event_id: string;
  event_type: typeof SCANNER_CALLBACK_EVENT_TYPE;
  idempotency_key: string;
  occurred_at: string;
  schema_version: typeof SCANNER_CALLBACK_SCHEMA_VERSION;
  result: {
    result_id: string;
    document_id: string;
    page_index: number;
    revision: number;
    service_date: string;
    outcome: 'accepted' | 'needs_review';
    artifacts: ScannerArtifactReference[];
    items: unknown[];
    versions: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export function parseScannerCallback(
  rawBody: Buffer,
  maxPayloadBytes: number,
): ScannerCallbackPayload {
  if (rawBody.length === 0) {
    throw badRequest('SCANNER.PAYLOAD_EMPTY', 'Callback payload is empty');
  }
  if (rawBody.length > maxPayloadBytes) {
    throw new PayloadTooLargeException({
      code: 'SCANNER.PAYLOAD_TOO_LARGE',
      message: 'Callback payload exceeds the configured limit',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw badRequest('SCANNER.PAYLOAD_INVALID_JSON', 'Callback payload is not valid JSON');
  }
  if (!isRecord(parsed)) {
    throw badRequest('SCANNER.PAYLOAD_INVALID', 'Callback payload must be an object');
  }
  if (parsed['schema_version'] !== SCANNER_CALLBACK_SCHEMA_VERSION) {
    throw badRequest('SCANNER.SCHEMA_UNSUPPORTED', 'Unsupported scanner callback schema');
  }
  if (parsed['event_type'] !== SCANNER_CALLBACK_EVENT_TYPE) {
    throw badRequest('SCANNER.EVENT_TYPE_UNSUPPORTED', 'Unsupported scanner event type');
  }

  const result = parsed['result'];
  if (!isRecord(result)) {
    throw badRequest('SCANNER.RESULT_INVALID', 'Callback result must be an object');
  }
  requireIdentifier(parsed['event_id'], 'event_id');
  requireIdentifier(parsed['idempotency_key'], 'idempotency_key', 255);
  requireIdentifier(result['result_id'], 'result.result_id');
  requireIdentifier(result['document_id'], 'result.document_id');
  requireUtcTimestamp(parsed['occurred_at']);
  if (!Number.isInteger(result['page_index']) || Number(result['page_index']) < 0) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.page_index must be non-negative');
  }
  if (!Number.isInteger(result['revision']) || Number(result['revision']) < 1) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.revision must be positive');
  }
  requireServiceDate(result['service_date']);
  if (!['accepted', 'needs_review'].includes(String(result['outcome']))) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.outcome is unsupported');
  }
  if (!Array.isArray(result['items']) || result['items'].length > 12) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.items must contain at most 12 rows');
  }
  if (!isRecord(result['versions'])) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.versions must be an object');
  }

  const artifacts = result['artifacts'];
  if (!Array.isArray(artifacts) || artifacts.length > SCANNER_CALLBACK_MAX_ARTIFACTS) {
    throw badRequest('SCANNER.ARTIFACTS_INVALID', 'result.artifacts is invalid');
  }
  const artifactIds = new Set<string>();
  for (const artifact of artifacts) validateArtifact(artifact, artifactIds);

  return parsed as unknown as ScannerCallbackPayload;
}

function validateArtifact(value: unknown, seenIds: Set<string>): void {
  if (!isRecord(value)) {
    throw badRequest('SCANNER.ARTIFACT_INVALID', 'Artifact reference must be an object');
  }
  requireIdentifier(value['artifact_id'], 'artifact_id');
  requireIdentifier(value['kind'], 'artifact.kind');
  if (typeof value['media_type'] !== 'string' || value['media_type'].length === 0 || value['media_type'].length > 100) {
    throw badRequest('SCANNER.ARTIFACT_INVALID', 'Artifact media type is invalid');
  }
  if (typeof value['sha256'] !== 'string' || !SHA256.test(value['sha256'])) {
    throw badRequest('SCANNER.ARTIFACT_INVALID', 'Artifact SHA-256 is invalid');
  }
  if (typeof value['url'] !== 'string' || value['url'].length > 1000) {
    throw badRequest('SCANNER.ARTIFACT_INVALID', 'Artifact URL is invalid');
  }
  const id = value['artifact_id'] as string;
  if (seenIds.has(id)) {
    throw badRequest('SCANNER.ARTIFACT_DUPLICATE', 'Artifact IDs must be unique');
  }
  seenIds.add(id);
}

function requireIdentifier(value: unknown, field: string, maxLength = 100): asserts value is string {
  const pattern = maxLength > 100 ? LONG_IDENTIFIER : IDENTIFIER;
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    throw badRequest('SCANNER.PAYLOAD_INVALID', `${field} is invalid`);
  }
}

function requireServiceDate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SERVICE_DATE.test(value)) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.service_date is invalid');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) {
    throw badRequest('SCANNER.RESULT_INVALID', 'result.service_date is invalid');
  }
}

function requireUtcTimestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw badRequest('SCANNER.PAYLOAD_INVALID', 'occurred_at must be a UTC ISO timestamp');
  }
  const match = UTC_TIMESTAMP.exec(value);
  if (!match) {
    throw badRequest('SCANNER.PAYLOAD_INVALID', 'occurred_at must be a UTC ISO timestamp');
  }
  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day) ||
    parsed.getUTCHours() !== Number(hour) ||
    parsed.getUTCMinutes() !== Number(minute) ||
    parsed.getUTCSeconds() !== Number(second)
  ) {
    throw badRequest('SCANNER.PAYLOAD_INVALID', 'occurred_at must be a valid UTC ISO timestamp');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}
