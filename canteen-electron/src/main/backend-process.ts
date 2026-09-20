import { fork, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';
import { AppConfig, databasePath } from './config-store';

let backendProcess: ChildProcess | null = null;

/** Returns the directory for crash/debug logs inside userData. */
function logDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Appends a timestamped entry to the crash log file. */
export function writeCrashLog(label: string, content: string): void {
  try {
    const file = path.join(logDir(), 'crash.log');
    const timestamp = new Date().toISOString();
    const entry = `\n--- ${label} [${timestamp}] ---\n${content}\n`;
    fs.appendFileSync(file, entry, 'utf-8');
  } catch {
    // Best-effort — don't crash the crash logger.
  }
}

/** Returns the path to the crash log file (for display to the user). */
export function crashLogPath(): string {
  return path.join(logDir(), 'crash.log');
}

/**
 * Detect the first non-internal IPv4 address on the local network.
 * Returns undefined if no suitable interface is found.
 */
function detectLanIp(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

/**
 * Kill any process currently occupying the given TCP port.
 * Handles orphaned backend processes from a previous unclean shutdown.
 * No-op if the port is free.
 */
function killPortOccupant(port: number): void {
  try {
    if (process.platform === 'win32') {
      // Parse netstat output to find the PID listening on the port.
      const output = execSync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port} "`,
        { encoding: 'utf-8', timeout: 5_000 },
      );
      const pids = new Set<number>();
      for (const line of output.split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0 && pid !== process.pid) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { timeout: 5_000 });
          console.log(`Killed stale process PID ${pid} on port ${port}`);
        } catch {
          // Process may have already exited — safe to ignore.
        }
      }
    } else {
      // macOS / Linux: use lsof to find the PID.
      const output = execSync(
        `lsof -ti tcp:${port}`,
        { encoding: 'utf-8', timeout: 5_000 },
      );
      for (const pidStr of output.trim().split('\n')) {
        const pid = parseInt(pidStr, 10);
        if (pid > 0 && pid !== process.pid) {
          try {
            process.kill(pid, 'SIGKILL');
            console.log(`Killed stale process PID ${pid} on port ${port}`);
          } catch {
            // Process may have already exited — safe to ignore.
          }
        }
      }
    }
  } catch {
    // Command fails when nothing is listening — expected, not an error.
  }
}

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
 * Extract a .tar archive using pure Node.js (no system tar dependency).
 * Handles ustar, GNU (type 'L' long names), and PAX (type 'x') formats.
 * Tar format: repeating [512-byte header][file data padded to 512 bytes].
 */
function extractTar(tarFile: string, destDir: string): void {
  const BLOCK = 512;
  const fd = fs.openSync(tarFile, 'r');
  const header = Buffer.alloc(BLOCK);
  let pendingLongName: string | null = null;

  /** Read exactly `size` bytes of entry data plus padding to next block boundary. */
  function readEntryData(size: number): Buffer {
    const data = Buffer.alloc(size);
    if (size > 0) fs.readSync(fd, data, 0, size, null);
    const remainder = size % BLOCK;
    if (remainder > 0) {
      const pad = Buffer.alloc(BLOCK - remainder);
      fs.readSync(fd, pad, 0, BLOCK - remainder, null);
    }
    return data;
  }

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, header, 0, BLOCK, null);
      if (bytesRead < BLOCK || header.every((b) => b === 0)) break;

      const name = header.subarray(0, 100).toString('utf-8').replace(/\0/g, '');
      const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0/g, '').trim();
      const typeFlag = header[156];
      const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0/g, '');
      const fileSize = sizeOctal ? parseInt(sizeOctal, 8) : 0;

      // GNU long-name extension: data holds the real filename for the next entry.
      if (typeFlag === 76) {
        pendingLongName = readEntryData(fileSize).toString('utf-8').replace(/\0/g, '');
        continue;
      }

      // PAX extended header: key-value pairs that may override the next entry's path.
      if (typeFlag === 120) {
        const paxData = readEntryData(fileSize).toString('utf-8');
        const match = paxData.match(/\d+ path=([^\n]+)\n/);
        if (match) pendingLongName = match[1];
        continue;
      }

      // Resolve the entry name: prefer GNU/PAX override, then ustar prefix+name.
      const headerName = prefix ? prefix + '/' + name : name;
      const fullName = pendingLongName ?? headerName;
      pendingLongName = null;
      const filePath = path.join(destDir, fullName);

      // Type '5' (ASCII 53) or trailing '/' = directory.
      if (typeFlag === 53 || fullName.endsWith('/')) {
        fs.mkdirSync(filePath, { recursive: true });
        readEntryData(fileSize);
        continue;
      }

      // Type '0' (ASCII 48) or NUL (0) = regular file.
      if (typeFlag === 0 || typeFlag === 48) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, readEntryData(fileSize));
        continue;
      }

      // Skip data for any other entry type (symlinks, hardlinks, etc.).
      readEntryData(fileSize);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract the backend dependencies tar archive on first launch.
 * Validates extraction by checking for a known required module (reflect-metadata).
 */
function ensureBackendDepsExtracted(): void {
  if (!app.isPackaged) return;

  const nmPath = backendNodeModulesPath();
  const tarPath = path.join(process.resourcesPath, 'backend-deps.tar');
  const markerModule = path.join(nmPath, 'reflect-metadata');

  // Already extracted and valid — nothing to do.
  if (fs.existsSync(markerModule)) {
    logBp('Backend dependencies already extracted');
    return;
  }

  if (!fs.existsSync(tarPath)) {
    throw new Error(`Backend dependencies archive not found: ${tarPath}`);
  }

  logBp(`Extracting backend dependencies from ${tarPath}...`);
  fs.mkdirSync(nmPath, { recursive: true });
  extractTar(tarPath, nmPath);
  logBp('Backend dependencies extracted successfully');
}

/** Log a timestamped backend-process step and persist to startup log file. */
function logBp(step: string): void {
  const line = `[BACKEND-PROC ${new Date().toISOString()}] ${step}`;
  console.log(line);
  try {
    const file = path.join(logDir(), 'startup.log');
    fs.appendFileSync(file, line + '\n', 'utf-8');
  } catch {
    // Best-effort — don't crash the logger.
  }
}

/**
 * Start the NestJS backend as a child process.
 * Uses ELECTRON_RUN_AS_NODE so the packaged Electron binary acts as plain Node.js.
 * Returns a Promise that resolves with the port number when the backend signals ready.
 */
export function startBackend(config: AppConfig): Promise<number> {
  // On first launch (packaged), extract the backend deps tar to node_modules.
  ensureBackendDepsExtracted();

  // Kill any orphaned process left on the port from a previous unclean shutdown.
  logBp(`Killing any occupant on port ${config.backendPort}...`);
  killPortOccupant(config.backendPort);
  logBp('Port cleanup done');

  return new Promise((resolve, reject) => {
    const entry = backendEntryPath();
    const timeoutMs = 60_000;

    logBp(`Backend entry: ${entry}`);
    logBp(`NODE_PATH: ${backendNodeModulesPath()}`);
    logBp(`DATABASE_PATH: ${databasePath()}`);
    logBp(`FRONTEND_DIST_PATH: ${frontendDistPath()}`);

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
      SEED_ADMIN_USERNAME: 'admin',
      SEED_ADMIN_PASSWORD: 'admin123',
      OMR_SERVICE_URL: 'local',
    };

    const lanIp = detectLanIp();
    if (lanIp) {
      env['LAN_IP'] = lanIp;
    }

    if (config.legacySyncEnabled) {
      env['LEGACY_SYNC_ENABLED'] = 'true';
      if (config.legacySqlHost) env['LEGACY_SQL_HOST'] = config.legacySqlHost;
      if (config.legacySqlUser) env['LEGACY_SQL_USER'] = config.legacySqlUser;
      if (config.legacySqlPass) env['LEGACY_SQL_PASS'] = config.legacySqlPass;
      if (config.legacySqlDb) env['LEGACY_SQL_DB'] = config.legacySqlDb;
      if (config.legacySqlPort) env['LEGACY_SQL_PORT'] = String(config.legacySqlPort);
    }

    // Use Electron's bundled Node runtime so the app works without a system Node install.
    // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node.js.
    env['ELECTRON_RUN_AS_NODE'] = '1';

    logBp('Forking backend child process...');
    backendProcess = fork(entry, [], {
      env,
      execPath: process.execPath,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    logBp(`Backend forked — PID ${backendProcess.pid}`);

    const timer = setTimeout(() => {
      logBp(`TIMEOUT: Backend did not become ready within ${timeoutMs}ms`);
      reject(new Error(`Backend failed to start within ${timeoutMs}ms`));
      stopBackend();
    }, timeoutMs);

    backendProcess.on('message', (msg: unknown) => {
      logBp(`IPC message received: ${JSON.stringify(msg)}`);
      if (msg && typeof msg === 'object') {
        const message = msg as { type: string; port?: number; message?: string };
        if (message.type === 'ready') {
          clearTimeout(timer);
          logBp(`Backend ready on port ${message.port ?? config.backendPort}`);
          resolve(message.port ?? config.backendPort);
        } else if (message.type === 'error') {
          clearTimeout(timer);
          logBp(`Backend startup error: ${message.message}`);
          reject(new Error(message.message ?? 'Backend startup failed'));
        }
      }
    });

    // Collect stderr/stdout for crash diagnostics.
    let stderrBuffer = '';
    let stdoutBuffer = '';

    backendProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrBuffer += text;
      console.error('[backend]', text);
    });

    backendProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdoutBuffer += text;
      console.log('[backend]', text);
    });

    backendProcess.on('exit', (code) => {
      clearTimeout(timer);
      backendProcess = null;
      if (code !== 0 && code !== null) {
        const errorMsg = `Backend exited with code ${code}`;
        writeCrashLog('BACKEND_EXIT', [
          errorMsg,
          `Entry: ${entry}`,
          `--- stderr ---`,
          stderrBuffer || '(empty)',
          `--- stdout ---`,
          stdoutBuffer || '(empty)',
        ].join('\n'));
        reject(new Error(`${errorMsg}\nSee crash log: ${crashLogPath()}`));
      }
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
      forceKillBackend();
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

/**
 * Synchronously kill the backend process.
 * Used as a safety net on process exit to prevent orphaned child processes.
 */
export function forceKillBackend(): void {
  if (!backendProcess) return;
  try {
    backendProcess.kill('SIGKILL');
  } catch {
    // Already dead — safe to ignore.
  }
  backendProcess = null;
}
