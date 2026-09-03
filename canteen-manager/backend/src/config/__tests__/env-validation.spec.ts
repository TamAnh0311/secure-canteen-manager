import { validateEnv } from '../env-validation';

const requiredEnv = {
  DATABASE_URL: 'postgresql://canteen:test@localhost:5432/canteen',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
};

const blankScannerEnv = {
  SCANNER_SERVICE_DATE_MAX_PAST_DAYS: '',
  SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: '',
  SCANNER_CALLBACK_TOKEN: '',
  SCANNER_ARTIFACT_TOKEN: '',
  SCANNER_ARTIFACT_ORIGIN: '',
  SCANNER_ARTIFACT_RETENTION_DAYS: '',
};

describe('validateEnv scanner configuration', () => {
  it('treats Compose-style blank scanner values as unset in legacy mode', () => {
    expect(validateEnv({
      ...requiredEnv,
      ...blankScannerEnv,
      SCAN_WORKFLOW_MODE: 'legacy_omr',
    })).toMatchObject({
      SCAN_WORKFLOW_MODE: 'legacy_omr',
      SCANNER_SERVICE_DATE_MAX_PAST_DAYS: undefined,
      SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS: undefined,
      SCANNER_CALLBACK_TOKEN: undefined,
      SCANNER_ARTIFACT_TOKEN: undefined,
      SCANNER_ARTIFACT_ORIGIN: undefined,
      SCANNER_ARTIFACT_RETENTION_DAYS: undefined,
    });
  });

  it('does not accept blank scanner values as explicit production configuration', () => {
    expect(() => validateEnv({
      ...requiredEnv,
      ...blankScannerEnv,
      NODE_ENV: 'production',
      SCAN_WORKFLOW_MODE: 'scanner_shadow',
      AGENT_TOKEN: 'test-agent-token-value',
      SCAN_RETENTION_DAYS: '30',
    })).toThrow(
      /SCANNER_SERVICE_DATE_MAX_PAST_DAYS is required in production.*SCANNER_SERVICE_DATE_MAX_FUTURE_DAYS is required in production.*SCANNER_CALLBACK_TOKEN is required in production.*SCANNER_ARTIFACT_TOKEN is required in production.*SCANNER_ARTIFACT_ORIGIN is required in production.*SCANNER_ARTIFACT_RETENTION_DAYS is required in production/,
    );
  });
});
