import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PurchaseLimitConfig } from '../purchase-limit-config.entity';
import { PurchaseLimitConfigService } from '../purchase-limit-config.service';
import { UpdatePurchaseLimitConfigDto } from '../dto/update-purchase-limit-config.dto';

function row(overrides: Partial<PurchaseLimitConfig> = {}): PurchaseLimitConfig {
  return {
    id: 'limit-1', singleton: true,
    prisonerFoodEnabled: true, prisonerFoodAmount: 100_000,
    prisonerEssentialEnabled: false, prisonerEssentialAmount: null,
    visitorFoodEnabled: true, visitorFoodAmount: 500_000,
    visitorEssentialEnabled: false, visitorEssentialAmount: null,
    updatedAt: new Date(), ...overrides,
  };
}

function dto(overrides: Partial<UpdatePurchaseLimitConfigDto> = {}): UpdatePurchaseLimitConfigDto {
  return {
    prisoner: { food: { enabled: true, amount: 100_000 }, essential: { enabled: false, amount: null } },
    visitor: { food: { enabled: true, amount: 500_000 }, essential: { enabled: false, amount: null } },
    ...overrides,
  };
}

function build(existing: PurchaseLimitConfig | null = row()) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => value),
  } as unknown as Repository<PurchaseLimitConfig>;
  return { service: new PurchaseLimitConfigService(repo), repo };
}

describe('PurchaseLimitConfigService', () => {
  it('cold-creates the approved defaults', async () => {
    const { service, repo } = build(null);
    const result = await service.getGlobal();
    expect(result).toMatchObject({ prisonerFoodAmount: 100_000, visitorFoodAmount: 500_000 });
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('replaces the full matrix and maps the nested view', async () => {
    const { service } = build();
    const saved = await service.updateGlobal(dto({
      prisoner: { food: { enabled: true, amount: 90_000 }, essential: { enabled: true, amount: 25_000 } },
    }));
    expect(service.toView(saved).prisoner).toEqual({
      food: { enabled: true, amount: 90_000 }, essential: { enabled: true, amount: 25_000 },
    });
  });

  it('rejects enabled null without saving any partial mutation', async () => {
    const original = row();
    const { service, repo } = build(original);
    const invalid = dto();
    invalid.prisoner.food = { enabled: true, amount: null };
    await expect(service.updateGlobal(invalid)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(original.prisonerFoodAmount).toBe(100_000);
  });

  it('retains a configured amount while disabled and restores it on re-enable', async () => {
    const configured = row({ prisonerEssentialAmount: 30_000 });
    const { service } = build(configured);
    const disabled = await service.updateGlobal(dto({
      prisoner: { food: { enabled: true, amount: 100_000 }, essential: { enabled: false, amount: null } },
    }));
    expect(disabled.prisonerEssentialAmount).toBe(30_000);
  });
});
