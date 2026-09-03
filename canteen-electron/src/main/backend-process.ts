import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import { app } from 'electron';
import { AppConfig, databasePath } from './config-store';

let backendProcess: ChildProcess | null = null;

/**
 * Resolve the path to the NestJS backend entry point.
 * In development: relative to project root.
 * In production: inside Electron's extraResources.
 */
function backendEntryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend', 'main.js');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'backend', 'dist', 'main.js');
}

/**
 * Resolve the path to the built frontend dist directory.
 */
function frontendDistPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'frontend', 'dist');
}

/**
 * Resolve the path to the backend's node_modules.
 */
function backendNodeModulesPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'backend-node_modules');
  }
  return path.join(__dirname, '..', '..', '..', 'canteen-manager', 'backend', 'node_modules');
}

/**
 * Start the NestJS backend as a child process.
 * Returns a Promise that resolves with the port number when the backend signals ready.
 */
export function startBackend(config: AppConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    const entry = backendEntryPath();
    const timeoutMs = 30_000;

    const env: Record<string, string> = {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_TYPE: 'sqlite',
      DATABASE_PATH: databasePath(),
      JWT_SECRET: config.jwtSecret,
      JWT_EXPIRES_IN: '12h',
      BACKEND_PORT: String(config.backendPort),
      APP_TZ: config.appTimezone,
      FRONTEND_DIST_PATH: frontendDistPath(),
      NODE_PATH: backendNodeModulesPath(),
    };

    if (config.legacySyncEnabled) {
      env['LEGACY_SYNC_ENABLED'] = 'true';
      if (config.legacySqlHost) env['LEGACY_SQL_HOST'] = config.legacySqlHost;
      if (config.legacySqlUser) env['LEGACY_SQL_USER'] = config.legacySqlUser;
      if (config.legacySqlPass) env['LEGACY_SQL_PASS'] = config.legacySqlPass;
      if (config.legacySqlDb) env['LEGACY_SQL_DB'] = config.legacySqlDb;
      if (config.legacySqlPort) env['LEGACY_SQL_PORT'] = String(config.legacySqlPort);
    }

    backendProcess = fork(entry, [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const timer = setTimeout(() => {
      reject(new Error(`Backend failed to start within ${timeoutMs}ms`));
      stopBackend();
    }, timeoutMs);

    backendProcess.on('message', (msg: unknown) => {
      if (msg && typeof msg === 'object') {
        const message = msg as { type: string; port?: number; message?: string };
        if (message.type === 'ready') {
          clearTimeout(timer);
          resolve(message.port ?? config.backendPort);
        } else if (message.type === 'error') {
          clearTimeout(timer);
          reject(new Error(message.message ?? 'Backend startup failed'));
        }
      }
    });

    backendProcess.on('exit', (code) => {
      clearTimeout(timer);
      backendProcess = null;
      if (code !== 0 && code !== null) {
        reject(new Error(`Backend exited with code ${code}`));
      }
    });

    backendProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[backend]', data.toString());
    });

    backendProcess.stdout?.on('data', (data: Buffer) => {
      console.log('[backend]', data.toString());
    });
  });
}

/**
 * Gracefully stop the backend process via IPC, with a 5s force-kill timeout.
 */
export function stopBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!backendProcess) {
      resolve();
      return;
    }

    const forceKillTimeout = setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill('SIGKILL');
        backendProcess = null;
      }
      resolve();
    }, 5_000);

    backendProcess.on('exit', () => {
      clearTimeout(forceKillTimeout);
      backendProcess = null;
      resolve();
    });

    backendProcess.send({ type: 'shutdown' });
  });
}
