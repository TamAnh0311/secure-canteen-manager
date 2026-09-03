import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PaymentConfigService,
  maskAccountNumber,
} from './payment-config.service';
import { PaymentConfig } from './payment-config.entity';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';

interface AuthRequest {
  user: OperatorPublic;
}

// Admin-facing view: the account number is masked to last-4 so the full value never leaves the
// server on read. Changing it requires re-entering the full number on PUT (it is not pre-filled),
// which doubles as the "confirm the account change" step.
export interface PaymentConfigView {
  bankBin: string | null;
  accountNumber: string | null;
  accountName: string | null;
  isConfigured: boolean;
}

class UpdatePaymentConfigBody {
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'bankBin must be 6 digits' })
  bankBin?: string;

  @IsOptional()
  @Matches(/^\d{6,19}$/, { message: 'accountNumber must be 6-19 digits' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(140)
  accountName?: string;
}

function toView(row: PaymentConfig): PaymentConfigView {
  return {
    bankBin: row.bankBin,
    accountNumber: maskAccountNumber(row.accountNumber),
    accountName: row.accountName,
    isConfigured: Boolean(row.bankBin && row.accountNumber && row.accountName),
  };
}

@Controller('config/payment')
@Roles(OperatorRole.ADMIN)
export class PaymentConfigController {
  constructor(private readonly service: PaymentConfigService) {}

  @Get()
  async get(): Promise<PaymentConfigView> {
    return toView(await this.service.getGlobal());
  }

  @Put()
  async update(
    @Body() body: UpdatePaymentConfigBody,
    @Req() req: AuthRequest,
  ): Promise<PaymentConfigView> {
    return toView(await this.service.updateGlobal(body, req.user.id));
  }
}
