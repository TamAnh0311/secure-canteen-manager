import * as fs from 'fs';
import * as path from 'path';
import { Injectable, LoggerService, LogLevel, OnModuleDestroy } from '@nestjs/common';

/**
 * File-backed session logger that captures all NestJS log output to a rotating
 * log file alongside the running database. Each app session gets its own file
 * (timestamped), and older files are pruned to stay under RETENTION_COUNT.
 *
 * Usage: provide as the NestJS logger in main.ts via `app.useLogger(sessionLogger)`.
 */

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB per file
const RETENTION_COUNT = 5; // keep the 5 most recent session logs
const LOG_DIR_NAME = 'logs';

/** Structured log entry written to the session file (one JSON line per entry). */
interface LogEntry {
  ts: string;
  level: string;
  context?: string;
  message: string;
  trace?: string;
}

@Injectable()
export class SessionLoggerService implements LoggerService, OnModuleDestroy {
  private logDir: string;
  private logFilePath: string;
  private stream: fs.WriteStream | null = null;
  private bytesWritten = 0;
  private readonly entries: LogEntry[] = [];

  constructor() {
    // Default log dir — overridden by init() when the database path is known.
    this.logDir = path.join(process.cwd(), LOG_DIR_NAME);
    this.logFilePath = '';
  }

  /**
   * Initialise the logger with the directory to write session logs into.
   * Call once from main.ts after the database path is resolved.
   */
  init(baseDir: string): void {
    this.logDir = path.join(baseDir, LOG_DIR_NAME);
    fs.mkdirSync(this.logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFilePath = path.join(this.logDir, `session-${stamp}.log`);
    this.stream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
    this.pruneOldLogs();
  }

  // ── LoggerService interface ──

  log(message: string, context?: string): void {
    this.write('log', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: string, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: string, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: string, context?: string): void {
    this.write('verbose', message, context);
  }

  fatal(message: string, context?: string): void {
    this.write('fatal', message, context);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Accept all levels — the file captures everything.
  }

  onModuleDestroy(): void {
    this.close();
  }

  // ── Public API for troubleshooting ──

  /**
   * Returns the path to the current session log file.
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * Returns all session log files sorted newest-first.
   */
  listLogFiles(): string[] {
    if (!fs.existsSync(this.logDir)) return [];
    return fs.readdirSync(this.logDir)
      .filter((f) => f.startsWith('session-') && f.endsWith('.log'))
      .sort()
      .reverse()
      .map((f) => path.join(this.logDir, f));
  }

  /**
   * Reads the current (or specified) log file and returns its content.
   * Optionally filter by level and limit the number of lines returned.
   */
  readLog(opts?: { filePath?: string; level?: string; tail?: number }): string {
    const target = opts?.filePath ?? this.logFilePath;
    if (!target || !fs.existsSync(target)) return '';
    let content = fs.readFileSync(target, 'utf-8');
    if (opts?.level) {
      const lines = content.split('\n').filter((line) => {
        if (!line.trim()) return false;
        try {
          const entry = JSON.parse(line) as LogEntry;
          return entry.level === opts.level;
        } catch {
          return false;
        }
      });
      content = lines.join('\n');
    }
    if (opts?.tail) {
      const lines = content.split('\n').filter((l) => l.trim());
      content = lines.slice(-opts.tail).join('\n');
    }
    return content;
  }

  /**
   * Collects diagnostic information for troubleshooting.
   * Returns a JSON string with system info, recent errors, and log file paths.
   */
  collectDiagnostics(): string {
    const recentErrors = this.entries
      .filter((e) => e.level === 'error' || e.level === 'fatal')
      .slice(-50);

    const diagnostics = {
      collectedAt: new Date().toISOString(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
        uptime: Math.round(process.uptime()),
        memoryUsage: process.memoryUsage(),
      },
      session: {
        logFile: this.logFilePath,
        logFiles: this.listLogFiles(),
        totalEntries: this.entries.length,
        errorCount: recentErrors.length,
      },
      recentErrors,
    };

    return JSON.stringify(diagnostics, null, 2);
  }

  /**
   * Writes a diagnostics bundle to a file and returns its path.
   * Intended for users to share when reporting issues.
   */
  exportDiagnostics(outputDir?: string): string {
    const dir = outputDir ?? this.logDir;
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(dir, `diagnostics-${stamp}.json`);
    fs.writeFileSync(outPath, this.collectDiagnostics(), 'utf-8');
    return outPath;
  }

  // ── Internals ──

  private write(level: string, message: string, context?: string, trace?: string): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      ...(context ? { context } : {}),
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...(trace ? { trace } : {}),
    };

    // Keep in-memory ring buffer for diagnostics (capped at 1000 entries).
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.shift();

    // Write to file.
    const line = JSON.stringify(entry) + '\n';
    if (this.stream && this.bytesWritten < MAX_LOG_SIZE) {
      this.stream.write(line);
      this.bytesWritten += Buffer.byteLength(line);
    }

    // Also emit to stderr so the Electron main process sees it.
    const prefix = context ? `[${context}] ` : '';
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(`${entry.ts} ${level.toUpperCase()} ${prefix}${entry.message}\n`);
      if (trace) process.stderr.write(`${trace}\n`);
    } else if (level === 'warn') {
      process.stderr.write(`${entry.ts} WARN ${prefix}${entry.message}\n`);
    } else {
      process.stdout.write(`${entry.ts} ${level.toUpperCase()} ${prefix}${entry.message}\n`);
    }
  }

  private pruneOldLogs(): void {
    const files = this.listLogFiles();
    for (const file of files.slice(RETENTION_COUNT)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Best-effort — don't fail the app if pruning fails.
      }
    }
  }

  private close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
