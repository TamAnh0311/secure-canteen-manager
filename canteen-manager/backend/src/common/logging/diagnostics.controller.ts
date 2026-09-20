import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import { Roles } from '../../auth/roles.decorator';
import { OperatorRole } from '../../operators/operator.entity';
import { SessionLoggerService } from './session-logger.service';

/**
 * Admin-only diagnostics controller for troubleshooting.
 * Exposes session logs and a diagnostics bundle endpoint so operators
 * can export debug information without direct filesystem access.
 */
@Controller('diagnostics')
@Roles(OperatorRole.ADMIN)
export class DiagnosticsController {
  constructor(private readonly sessionLogger: SessionLoggerService) {}

  /** Returns the JSON diagnostics bundle (system info + recent errors). */
  @Get()
  getDiagnostics(): object {
    return JSON.parse(this.sessionLogger.collectDiagnostics());
  }

  /** Lists available session log files. */
  @Get('logs')
  listLogs(): { files: string[] } {
    return { files: this.sessionLogger.listLogFiles() };
  }

  /** Returns recent log content, optionally filtered by level or limited by tail count. */
  @Get('logs/recent')
  getRecentLogs(
    @Query('level') level?: string,
    @Query('tail') tail?: string,
  ): { content: string } {
    return {
      content: this.sessionLogger.readLog({
        level,
        tail: tail ? parseInt(tail, 10) : 200,
      }),
    };
  }

  /** Downloads the full diagnostics bundle as a JSON file. */
  @Get('export')
  exportDiagnostics(@Res() res: Response): void {
    const outPath = this.sessionLogger.exportDiagnostics();
    res.download(outPath, `canteen-diagnostics-${Date.now()}.json`, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ message: 'Failed to export diagnostics' });
      }
    });
  }

  /** Downloads the current session log file directly. */
  @Get('logs/download')
  downloadCurrentLog(@Res() res: Response): void {
    const logPath = this.sessionLogger.getLogFilePath();
    if (!logPath || !fs.existsSync(logPath)) {
      res.status(404).json({ message: 'No session log file available' });
      return;
    }
    res.download(logPath, `session-log-${Date.now()}.log`, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ message: 'Failed to download log' });
      }
    });
  }
}
