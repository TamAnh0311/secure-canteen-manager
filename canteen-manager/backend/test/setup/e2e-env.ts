// e2e environment wiring. Runs (via jest `setupFiles`) BEFORE any test module — and therefore
// before AppModule's ConfigModule — is imported. NestJS ConfigModule loads its env file with
// dotenv `override:false`, so it never clobbers a process.env value already set here; setting
// DATABASE_URL up front is what repoints the whole app at the e2e database instead of the
// unreachable deploy/.env host.
//
// The e2e suite targets its OWN database (canteen_e2e), kept distinct from the schema-shape
// unit test's canteen_test so the two suites can never truncate or drop each other's data when
// run back to back. globalSetup drops + re-migrates this database to the current schema once
// per run, so the suite never executes against a stale (session-era) shape.

process.env.DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://canteen:change_me_in_production@localhost:55433/canteen_e2e';

// 32+ char secret to satisfy env-validation; value is irrelevant to the tests themselves.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'e2e-test-jwt-secret-key-at-least-32-chars-long';

// The scan-submission agent token the ingestion specs send as x-agent-token. Min 16 chars.
process.env.AGENT_TOKEN = process.env.AGENT_TOKEN ?? 'e2e-agent-token-1234567890';

// Must be set before AppModule's static import loads deploy/.env, whose Docker hostname is not
// resolvable from host-run e2e tests. Explicit caller configuration still wins.
process.env.OMR_SERVICE_URL = process.env.OMR_SERVICE_URL ?? 'http://localhost:8000';

// Pin the day-bucketing timezone so service_date stamping is deterministic across hosts.
process.env.APP_TZ = process.env.APP_TZ ?? 'Asia/Saigon';

// Host disk utilization is unrelated to admission behavior under test. Keep the production
// high-watermark guard enabled while allowing the isolated E2E suite to run on fuller dev disks.
process.env.SCAN_STORAGE_HIGH_WATERMARK =
  process.env.SCAN_STORAGE_HIGH_WATERMARK ?? '0.99';

process.env.NODE_ENV = 'test';
