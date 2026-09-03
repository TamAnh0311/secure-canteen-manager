import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentConfig } from './payment-config.entity';
import { isAllowedBankBin } from './napas-bank-bins';
import { asciiFold } from '../common/ascii-fold';

export interface UpdatePaymentConfigDto {
  bankBin?: string;
  accountNumber?: string;
  accountName?: string;
}

// Postgres unique-violation SQLSTATE. TypeORM surfaces it on the error itself or its nested
// driverError depending on the failure path.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

@Injectable()
export class PaymentConfigService {
  private readonly logger = new Logger('PaymentConfig');

  constructor(
    @InjectRepository(PaymentConfig)
    private readonly repo: Repository<PaymentConfig>,
  ) {}

  // Returns the single global config row, seeding an EMPTY row (all fields null) if absent.
  // Unlike threshold_config there is no env source to copy — the row is blank until an admin
  // sets it. The migration seeds the row up front, so on the public kiosk path this is a pure
  // read; the get-or-create with 23505-recovery is a defensive fallback (cold/test DBs).
  async getGlobal(): Promise<PaymentConfig> {
    const existing = await this.repo.findOne({ where: {} });
    if (existing) return existing;

    const row = this.repo.create({ singleton: true });
    try {
      return await this.repo.save(row);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await this.repo.findOne({ where: {} });
        if (winner) return winner;
      }
      throw e;
    }
  }

  // Validates + persists the canteen account. accountName is ascii-folded at write. Logs the
  // change with operator attribution (BIN + masked account) for an audit trail without a
  // dedicated table. Validation runs only on update — never on the blank seed.
  async updateGlobal(dto: UpdatePaymentConfigDto, operatorId?: string): Promise<PaymentConfig> {
    const row = await this.getGlobal();

    if (dto.bankBin !== undefined) row.bankBin = dto.bankBin;
    if (dto.accountNumber !== undefined) row.accountNumber = dto.accountNumber;
    if (dto.accountName !== undefined) row.accountName = asciiFold(dto.accountName);

    this.validate(row);
    const saved = await this.repo.save(row);
    this.logger.log(
      `payment config updated by operator ${operatorId ?? 'unknown'}: ` +
        `bankBin=${saved.bankBin} account=${maskAccountNumber(saved.accountNumber)}`,
    );
    return saved;
  }

  // Configured = all three fields present and non-empty. The kiosk gates the bank tender on this
  // so no unconfigured-bank order is ever created (it would have no QR).
  async isConfigured(): Promise<boolean> {
    const row = await this.getGlobal();
    return Boolean(row.bankBin && row.accountNumber && row.accountName);
  }

  private validate(row: PaymentConfig): void {
    if (!row.bankBin || !/^\d{6}$/.test(row.bankBin)) {
      throw new BadRequestException({
        message: 'bankBin must be 6 digits',
        code: 'PAYMENT_CONFIG.BANK_BIN_INVALID',
      });
    }
    if (!isAllowedBankBin(row.bankBin)) {
      throw new BadRequestException({
        message: 'bankBin is not a recognised NAPAS member bank',
        code: 'PAYMENT_CONFIG.BANK_BIN_NOT_ALLOWED',
      });
    }
    if (!row.accountNumber || !/^\d{6,19}$/.test(row.accountNumber)) {
      throw new BadRequestException({
        message: 'accountNumber must be 6-19 digits',
        code: 'PAYMENT_CONFIG.ACCOUNT_NUMBER_INVALID',
      });
    }
    if (!row.accountName || row.accountName.length === 0 || row.accountName.length > 140) {
      throw new BadRequestException({
        message: 'accountName must be non-empty and at most 140 characters after folding',
        code: 'PAYMENT_CONFIG.ACCOUNT_NAME_INVALID',
      });
    }
  }
}

// Last-4 masking for admin display + logs; the full account number is never returned on GET.
export function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) return accountNumber;
  if (accountNumber.length <= 4) return accountNumber;
  return '*'.repeat(accountNumber.length - 4) + accountNumber.slice(-4);
}
