import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

/** Persistent app configuration stored in %APPDATA%/Canteen Manager/config.json. */
export interface AppConfig {
  jwtSecret: string;
  backendPort: number;
  appTimezone: string;
  legacySyncEnabled: boolean;
  legacySqlHost?: string;
  legacySqlUser?: string;
  legacySqlPass?: string;
  legacySqlDb?: string;
  legacySqlPort?: number;
}

const CONFIG_FILENAME = 'config.json';

/**
 * Return the path to the config file in the user's app data directory.
 */
function configPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

/**
 * Return the path to the SQLite database file.
 */
export function databasePath(): string {
  return path.join(app.getPath('userData'), 'canteen.sqlite');
}

/**
 * Load config from disk. Returns null if the file does not exist.
 */
export function loadConfig(): AppConfig | null {
  const p = configPath();
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

/**
 * Save config to disk.
 */
export function saveConfig(config: AppConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Generate a default config with a random JWT secret.
 */
export function createDefaultConfig(): AppConfig {
  return {
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    backendPort: 6868,
    appTimezone: 'Asia/Saigon',
    legacySyncEnabled: false,
  };
}
