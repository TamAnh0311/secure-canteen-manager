import { z } from 'zod';

// Safely coerce string env vars to boolean: treats 'true' as true, everything else as false.
// Do NOT use z.coerce.boolean() — it treats the string 'false' as truthy.
const boolFromString = (defaultVal: 'true' | 'false') =>
  z.enum(['true', 'false']).transform((v) => v === 'true').default(defaultVal);

const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BACKEND_PORT: z.coerce.number().default(3000),
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  KIOSK_LOOKUP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  // Deploy timezone used to server-stamp scan/order service dates. An IANA zone name
  // (e.g. Asia/Saigon). Drives the day-bucketing boundary, so a wrong value mis-buckets
  // every order near local midnight — defaulted to the operating site's zone.
  APP_TZ: z.string().default('Asia/Saigon'),

  // Legacy SQL Server sync — all optional so the app boots with no legacy box configured.
  LEGACY_SQL_HOST: z.string().optional(),
  LEGACY_SQL_USER: z.string().optional(),
  LEGACY_SQL_PASS: z.string().optional(),
  LEGACY_SQL_DB: z.string().optional(),
  LEGACY_SQL_PORT: z.coerce.number().default(1433),
  // encrypt:false = trusted LAN (default). Set true + TLS_MIN_VERSION for encrypted connections.
  LEGACY_SQL_ENCRYPT: boolFromString('false'),
  LEGACY_SQL_TRUST_CERT: boolFromString('true'),
  LEGACY_SQL_TDS_VERSION: z.string().default('7_2'),
  LEGACY_SQL_TLS_MIN_VERSION: z.string().optional(),
  LEGACY_SQL_QUERY: z.string().optional(),
  LEGACY_SQL_POOL_SIZE: z.coerce.number().default(5),
  LEGACY_SQL_QUERY_TIMEOUT_MS: z.coerce.number().default(60000),
  LEGACY_SYNC_CRON: z.string().default('0 */4 * * *'),
  LEGACY_SYNC_ENABLED: boolFromString('false'),

  // OMR service — scan form generation and processing
  OMR_SERVICE_URL: z.string().default('http://localhost:8000'),
  OMR_SERVICE_TIMEOUT_MS: z.coerce.number().default(30000),
  OMR_OPERATIONAL_FORM_MODE: z.enum(['issued', 'generic']).default('issued'),
  OMR_OPERATIONAL_FORM_GENERATION: z.string().min(1).max(64).default('issued-v1'),
  SCAN_WORKFLOW_MODE: z.enum(['legacy_omr', 'scanner_shadow', 'scanner_webhook']).default('legacy_omr'),

  // Agent token for scan-submission endpoint (hardware agent auth).
  // Optional, but min 16 chars when set. No insecure fallback: an unset token leaves
  // the x-agent-token path disabled (the guard rejects it) rather than accepting a
  // well-known default — required in production via the refine below. Operator JWTs
  // remain a valid second auth path regardless.
  AGENT_TOKEN: z.string().min(16).optional(),

  // Where raw scan images are stored on disk
  SCAN_STORAGE_DIR: z.string().default('./data/scans'),
  SCAN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  SCAN_MAX_CONCURRENT_PER_CREDENTIAL: z.coerce.number().int().positive().default(2),
  SCAN_MAX_PENDING: z.coerce.number().int().positive().default(500),
  SCAN_STORAGE_HIGH_WATERMARK: z.coerce.number().min(0.5).max(0.99).default(0.90),
  // Required explicitly in production: scan images and sensitive OMR results must
  // never fall back to indefinite retention.
  SCAN_RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  SCANNER_SERVICE_DATE_MAX_PAST_DAYS: optionalEnv(z.coerce.number().int().nonnegative()),
  SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: optionalEnv(z.coerce.number().int().nonnegative()),
  // Scanner webhook trust boundaries. These are optional for legacy OMR mode,
  // but scanner modes must configure all three values explicitly in production.
  SCANNER_CALLBACK_TOKEN: optionalEnv(z.string().min(16)),
  SCANNER_ARTIFACT_TOKEN: optionalEnv(z.string().min(16)),
  SCANNER_ARTIFACT_ORIGIN: optionalEnv(z.string().url()),
  SCANNER_WEBHOOK_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(512 * 1024),
  SCANNER_ARTIFACT_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  SCANNER_ARTIFACT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SCANNER_ARTIFACT_RETENTION_DAYS: optionalEnv(z.coerce.number().int().positive()),

  // OMR/ICR thresholds — the threshold_config row overrides these; these are the fallback
  ICR_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.85),
  OMR_EMPTY_MAX: z.coerce.number().default(0.30),
  OMR_TICKED_MIN: z.coerce.number().default(0.70),
  DIGIT_BOX_COUNT: z.coerce.number().default(6),
  OMR_DPI: z.coerce.number().default(300),
}).superRefine((env, ctx) => {
  // The x-agent-token scan path drives the (now balance-bound) verify queue. In
  // production it must be configured explicitly — no boot with the path silently
  // disabled, since hardware agents could not submit at all otherwise.
  if (env.NODE_ENV === 'production' && !env.AGENT_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AGENT_TOKEN'],
      message: 'AGENT_TOKEN is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && !env.SCAN_RETENTION_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCAN_RETENTION_DAYS'],
      message: 'SCAN_RETENTION_DAYS is required in production',
    });
  }
  const scannerEnabled = env.SCAN_WORKFLOW_MODE !== 'legacy_omr';
  if (env.NODE_ENV === 'production' && scannerEnabled && env.SCANNER_SERVICE_DATE_MAX_PAST_DAYS === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_SERVICE_DATE_MAX_PAST_DAYS'],
      message: 'SCANNER_SERVICE_DATE_MAX_PAST_DAYS is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && scannerEnabled && env.SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS'],
      message: 'SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && scannerEnabled && !env.SCANNER_CALLBACK_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_CALLBACK_TOKEN'],
      message: 'SCANNER_CALLBACK_TOKEN is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && scannerEnabled && !env.SCANNER_ARTIFACT_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_ARTIFACT_TOKEN'],
      message: 'SCANNER_ARTIFACT_TOKEN is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && scannerEnabled && !env.SCANNER_ARTIFACT_ORIGIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_ARTIFACT_ORIGIN'],
      message: 'SCANNER_ARTIFACT_ORIGIN is required in production',
    });
  }
  if (env.NODE_ENV === 'production' && scannerEnabled && !env.SCANNER_ARTIFACT_RETENTION_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_ARTIFACT_RETENTION_DAYS'],
      message: 'SCANNER_ARTIFACT_RETENTION_DAYS is required in production',
    });
  }
  if (env.SCANNER_CALLBACK_TOKEN && env.SCANNER_ARTIFACT_TOKEN && env.SCANNER_CALLBACK_TOKEN === env.SCANNER_ARTIFACT_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SCANNER_ARTIFACT_TOKEN'],
      message: 'SCANNER_CALLBACK_TOKEN and SCANNER_ARTIFACT_TOKEN must differ',
    });
  }
  if (env.SCANNER_ARTIFACT_ORIGIN) {
    const origin = new URL(env.SCANNER_ARTIFACT_ORIGIN);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SCANNER_ARTIFACT_ORIGIN'],
        message: 'SCANNER_ARTIFACT_ORIGIN must be an HTTPS origin without path or credentials',
      });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Environment validation failed: ${errors}`);
  }
  return result.data;
}
