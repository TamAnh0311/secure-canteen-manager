import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PaymentConfigService, maskAccountNumber } from '../payment-config.service';
import { PaymentConfig } from '../payment-config.entity';

function makeRepo(overrides: Partial<Repository<PaymentConfig>> = {}) {
  return {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<PaymentConfig>) => ({ ...data } as PaymentConfig)),
    save: jest.fn(async (entity: PaymentConfig) => entity),
    ...overrides,
  } as unknown as Repository<PaymentConfig>;
}

function makeRow(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    id: 'pc-1',
    singleton: true,
    bankBin: null,
    accountNumber: null,
    accountName: null,
    updatedAt: new Date(),
    ...overrides,
  } as PaymentConfig;
}

function build(repoOverrides: Partial<Repository<PaymentConfig>> = {}) {
  const repo = makeRepo(repoOverrides);
  const svc = new PaymentConfigService(repo);
  return { svc, repo };
}

describe('PaymentConfigService.getGlobal()', () => {
  it('returns the existing row without seeding', async () => {
    const existing = makeRow({ bankBin: '970436' });
    const { svc, repo } = build({ findOne: jest.fn().mockResolvedValue(existing) });
    const result = await svc.getGlobal();
    expect(result).toBe(existing);
    expect((repo.save as jest.Mock).mock.calls).toHaveLength(0);
  });

  it('seeds an empty row (singleton only, no env reads) when none exists', async () => {
    const { svc, repo } = build({ findOne: jest.fn().mockResolvedValue(null) });
    const result = await svc.getGlobal();
    expect((repo.save as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(result.singleton).toBe(true);
    expect(result.bankBin).toBeUndefined(); // created with no field values
  });

  it('recovers the winner row when a concurrent seed loses the singleton race (23505)', async () => {
    const winner = makeRow();
    const findOne = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const save = jest.fn().mockRejectedValue({ code: '23505' });
    const { svc } = build({ findOne, save });
    const result = await svc.getGlobal();
    expect(result).toBe(winner);
    expect(findOne).toHaveBeenCalledTimes(2);
  });
});

describe('PaymentConfigService.updateGlobal()', () => {
  const valid = { bankBin: '970436', accountNumber: '1234567890', accountName: 'Quy Can Tin' };

  it('persists valid values and ascii-folds the account name', async () => {
    const { svc, repo } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const saved = await svc.updateGlobal(valid, 'op-1');
    expect((repo.save as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(saved.bankBin).toBe('970436');
    expect(saved.accountNumber).toBe('1234567890');
    expect(saved.accountName).toBe('QUY CAN TIN'); // folded + uppercased at write
  });

  it('folds diacritics in the account name at write', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const saved = await svc.updateGlobal({ ...valid, accountName: 'Nguyễn Văn Á' }, 'op-1');
    expect(saved.accountName).toBe('NGUYEN VAN A');
  });

  it('rejects a malformed BIN with BANK_BIN_INVALID', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const err = await svc.updateGlobal({ ...valid, bankBin: '12345' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PAYMENT_CONFIG.BANK_BIN_INVALID' });
  });

  it('rejects a non-NAPAS BIN with BANK_BIN_NOT_ALLOWED', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const err = await svc.updateGlobal({ ...valid, bankBin: '999999' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PAYMENT_CONFIG.BANK_BIN_NOT_ALLOWED' });
  });

  it('rejects a malformed account number with ACCOUNT_NUMBER_INVALID', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const err = await svc.updateGlobal({ ...valid, accountNumber: '123' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PAYMENT_CONFIG.ACCOUNT_NUMBER_INVALID' });
  });

  it('rejects an account name that folds to empty with ACCOUNT_NAME_INVALID', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow()) });
    const err = await svc.updateGlobal({ ...valid, accountName: '„”—' }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PAYMENT_CONFIG.ACCOUNT_NAME_INVALID' });
  });
});

describe('PaymentConfigService.isConfigured()', () => {
  it('is false when any field is missing', async () => {
    const { svc } = build({ findOne: jest.fn().mockResolvedValue(makeRow({ bankBin: '970436', accountNumber: '123456' })) });
    expect(await svc.isConfigured()).toBe(false);
  });

  it('is true when all fields are present', async () => {
    const { svc } = build({
      findOne: jest.fn().mockResolvedValue(makeRow({ bankBin: '970436', accountNumber: '1234567890', accountName: 'QUY CAN TIN' })),
    });
    expect(await svc.isConfigured()).toBe(true);
  });
});

describe('maskAccountNumber', () => {
  it('masks all but the last four digits', () => {
    expect(maskAccountNumber('1234567890')).toBe('******7890');
  });

  it('passes through null and short values unchanged', () => {
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskAccountNumber('12')).toBe('12');
  });
});
