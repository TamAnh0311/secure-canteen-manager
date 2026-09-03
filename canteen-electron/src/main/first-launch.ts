import * as fs from 'fs';
import { dialog } from 'electron';
import { databasePath, loadConfig, saveConfig, createDefaultConfig, AppConfig } from './config-store';

/**
 * Check if this is the first launch (no config file exists).
 * If so, create default config and prompt for admin credentials.
 * Returns the config to use for this session.
 */
export async function ensureConfig(): Promise<AppConfig> {
  let config = loadConfig();

  if (config) {
    return config;
  }

  // First launch — create defaults
  config = createDefaultConfig();

  // Prompt for admin username
  const usernameResult = await dialog.showMessageBox({
    type: 'question',
    title: 'Canteen Manager — First Launch',
    message: 'Welcome! Set up the admin account.\n\nUse default admin credentials?\nUsername: admin\nPassword: admin123',
    buttons: ['Use Defaults', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });

  if (usernameResult.response === 1) {
    // User cancelled — use defaults anyway (they can change password later)
  }

  // Save config
  saveConfig(config);

  return config;
}

/**
 * Check if the SQLite database file exists.
 */
export function isDatabaseInitialized(): boolean {
  return fs.existsSync(databasePath());
}
