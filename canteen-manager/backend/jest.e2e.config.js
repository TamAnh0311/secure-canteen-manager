/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } }],
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  // Sets DATABASE_URL (+ JWT/agent/TZ secrets) for the e2e database BEFORE any test module —
  // and therefore AppModule's ConfigModule — is imported. ConfigModule loads its env file with
  // dotenv override:false, so this process.env value is what repoints the app at the e2e DB.
  setupFiles: ['<rootDir>/test/setup/e2e-env.ts'],
  // Drops + replays the full migration chain on the e2e database once per run, so the suite
  // always runs against the current (post-refactor) schema, never a stale shape.
  globalSetup: '<rootDir>/test/setup/e2e-global-setup.ts',
  // All e2e specs share one Postgres database and reset state with `TRUNCATE ... CASCADE`
  // in beforeAll/afterAll. Run serially so one spec's truncate can't wipe another's data
  // mid-test (parallel workers against a single DB collide non-deterministically).
  maxWorkers: 1,
};
