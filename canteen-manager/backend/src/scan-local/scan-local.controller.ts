import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import {
  ScanLocalService,
  ScanProcessResult,
  ScanHistoryItem,
  ScanStats,
} from './scan-local.service';

@Controller('scan-local')
export class ScanLocalController {
  constructor(private readonly scanLocalService: ScanLocalService) {}

  /**
   * Processes a scanned form image through the local OMR pipeline.
   * Requires the caller to be an authenticated operator, admin, or cashier.
   *
   * @param body  Request body containing the base64-encoded scan image.
   * @param req   Authenticated request carrying the operator identity.
   * @returns     Scan result with detected items and pipeline status.
   */
  @Post('process')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN, OperatorRole.CASHIER)
  async processScan(
    @Body() body: { imageBase64: string },
    @Req() req: { user: OperatorPublic },
  ): Promise<ScanProcessResult> {
    return this.scanLocalService.processScan(body.imageBase64, req.user.id);
  }

  /**
   * Returns recent orders created via the phone scan pipeline.
   *
   * @param dateFrom Inclusive start date (YYYY-MM-DD). Defaults to today.
   * @param dateTo   Inclusive end date (YYYY-MM-DD). Defaults to today.
   * @returns Array of scan history items, newest first.
   */
  @Get('history')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN, OperatorRole.CASHIER)
  async getHistory(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<ScanHistoryItem[]> {
    return this.scanLocalService.getHistory(dateFrom, dateTo);
  }

  /**
   * Returns aggregate KPIs for scanner-originated orders.
   *
   * @param dateFrom Inclusive start date (YYYY-MM-DD). Defaults to today.
   * @param dateTo   Inclusive end date (YYYY-MM-DD). Defaults to today.
   * @returns Scan statistics for the given date range.
   */
  @Get('stats')
  @Roles(OperatorRole.OPERATOR, OperatorRole.ADMIN, OperatorRole.CASHIER)
  async getStats(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<ScanStats> {
    return this.scanLocalService.getStats(dateFrom, dateTo);
  }
}
