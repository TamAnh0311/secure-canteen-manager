import { z } from 'zod';

/**
 * Environment validation schema for the canteen backend.
 * Supports both PostgreSQL (Docker) and SQLite (Electron) modes via DATABASE_TYPE.
 */

const boolFromString = (defaultVal: 'true' | 'false') =>
  z.enum(['true', 'false']).transform((v) => v === 'true').default(defaultVal);

const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  // Database — either 'postgres' (Docker) or 'sqlite' (Electron)
  DATABASE_TYPE: z.enum(['postgres', 'sqlite']).default('postgres'),
  DATABASE_URL: z.string().optional(),
  DATABASE_PATH: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  BACKEND_PORT: z.coerce.number().default(3000),
  SEED_ADMIN_USERNAME: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  KIOSK_LOOKUP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  APP_TZ: z.string().default('Asia/Saigon'),

  // OMR service — external PDF renderer for scan forms
  OMR_SERVICE_URL: z.string().default('http://localhost:8000'),
  OMR_SERVICE_TIMEOUT_MS: z.coerce.number().default(30000),

  // Scan workflow mode
  SCAN_WORKFLOW_MODE: z.enum(['legacy_omr', 'scanner_shadow', 'scanner_webhook']).default('legacy_omr'),

  // Recognition thresholds
  ICR_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.85),
  OMR_EMPTY_MAX: z.coerce.number().default(0.30),
  OMR_TICKED_MIN: z.coerce.number().default(0.70),
  DIGIT_BOX_COUNT: z.coerce.number().default(6),

  // OMR operational mode (issued = personalized per-prisoner forms, generic = shared master)
  OMR_OPERATIONAL_FORM_MODE: z.enum(['issued', 'generic']).default('issued'),
  OMR_OPERATIONAL_FORM_GENERATION: z.string().default('default'),

  // Static file serving — set by Electron to serve React build
  FRONTEND_DIST_PATH: z.string().optional(),

  // LAN IP — set by Electron for tablet connection QR code
  LAN_IP: z.string().optional(),

  // Legacy SQL Server sync — all optional
  LEGACY_SQL_HOST: z.string().optional(),
  LEGACY_SQL_USER: z.string().optional(),
  LEGACY_SQL_PASS: z.string().optional(),
  LEGACY_SQL_DB: z.string().optional(),
  LEGACY_SQL_PORT: z.coerce.number().default(1433),
  LEGACY_SQL_ENCRYPT: boolFromString('false'),
  LEGACY_SQL_TRUST_CERT: boolFromString('true'),
  LEGACY_SQL_TDS_VERSION: z.string().default('7_2'),
  LEGACY_SQL_TLS_MIN_VERSION: z.string().optional(),
  LEGACY_SQL_QUERY: z.string().optional(),
  LEGACY_SQL_POOL_SIZE: z.coerce.number().default(5),
  LEGACY_SQL_QUERY_TIMEOUT_MS: z.coerce.number().default(60000),
  LEGACY_SYNC_CRON: z.string().default('0 */4 * * *'),
  LEGACY_SYNC_ENABLED: boolFromString('false'),
}).superRefine((env, ctx) => {
  if (env.DATABASE_TYPE === 'postgres' && !env.DATABASE_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required when DATABASE_TYPE is postgres',
    });
  }
  if (env.DATABASE_TYPE === 'sqlite' && !env.DATABASE_PATH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_PATH'],
      message: 'DATABASE_PATH is required when DATABASE_TYPE is sqlite',
    });
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
