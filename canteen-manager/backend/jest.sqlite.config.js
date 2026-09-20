/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/sqlite/.*\\.sqlite-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true },
    }],
  },
  testEnvironment: 'node',
  testTimeout: 30000,
  // Set SQLite env BEFORE any module is imported.
  setupFiles: ['<rootDir>/test/setup/sqlite-env.ts'],
  // Serial: each spec shares the same SQLite file, sequential avoids WAL contention.
  maxWorkers: 1,
};
