import { Body, Controller, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { ScanLocalService, ScanProcessResult } from './scan-local.service';

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
}
