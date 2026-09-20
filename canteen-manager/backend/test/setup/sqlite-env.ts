/**
 * SQLite integration test environment.
 * Sets up environment variables so the app boots in Electron/SQLite mode
 * with an in-memory (or temp-file) database. Runs via jest setupFiles
 * BEFORE any module import.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// Unique temp directory per test run so parallel runs cannot collide.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canteen-sqlite-test-'));
const dbPath = path.join(tmpDir, 'canteen-test.sqlite');

process.env.DATABASE_TYPE = 'sqlite';
process.env.DATABASE_PATH = dbPath;
process.env.JWT_SECRET = 'sqlite-test-jwt-secret-key-at-least-32-chars-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.BACKEND_PORT = '0'; // Let OS pick a free port
process.env.NODE_ENV = 'test';
process.env.APP_TZ = 'Asia/Saigon';
process.env.OMR_SERVICE_URL = 'local'; // Use local renderer, no external sidecar
process.env.SCAN_WORKFLOW_MODE = 'legacy_omr';
process.env.SEED_ADMIN_USERNAME = '';
process.env.SEED_ADMIN_PASSWORD = '';
