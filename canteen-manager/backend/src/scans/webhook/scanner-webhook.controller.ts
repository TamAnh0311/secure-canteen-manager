import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { ScannerWebhookAuthGuard } from './scanner-webhook-auth.guard';
import { ScannerWebhookService } from './scanner-webhook.service';

type RawRequest = Request & { body?: unknown };

@Controller('webhooks/order-scanner')
export class ScannerWebhookController {
  constructor(private readonly webhook: ScannerWebhookService) {}

  @Post()
  @Public()
  @UseGuards(ScannerWebhookAuthGuard)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async receive(@Req() request: RawRequest): Promise<{
    event_id: string;
    state: string;
    duplicate: boolean;
    quarantined: boolean;
  }> {
    if (!request.is('application/json')) {
      throw new UnsupportedMediaTypeException({
        code: 'SCANNER.CONTENT_TYPE_UNSUPPORTED',
        message: 'Scanner callbacks require application/json',
      });
    }
    if (!Buffer.isBuffer(request.body)) {
      throw new BadRequestException({
        code: 'SCANNER.RAW_BODY_UNAVAILABLE',
        message: 'Scanner callback bytes could not be read',
      });
    }
    const receipt = await this.webhook.ingest(
      request.body,
      typeof request.headers['idempotency-key'] === 'string'
        ? request.headers['idempotency-key']
        : undefined,
    );
    return {
      event_id: receipt.eventId,
      state: receipt.state,
      duplicate: receipt.duplicate,
      quarantined: receipt.quarantined,
    };
  }
}
