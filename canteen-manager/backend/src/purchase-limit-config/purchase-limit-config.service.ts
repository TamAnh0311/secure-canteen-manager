import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MAX_VND } from '../common/numeric.transformer';
import { sqliteSafeLock } from '../common/sqlite-safe-lock';
import { PurchaseLimitConfig } from './purchase-limit-config.entity';
import { UpdatePurchaseLimitConfigDto } from './dto/update-purchase-limit-config.dto';

export type PurchaseLimitAudience = 'prisoner' | 'visitor';
export interface PurchaseLimitRule { enabled: boolean; amount: number | null }
export interface EffectivePurchaseLimits { food: PurchaseLimitRule; essential: PurchaseLimitRule }
export interface PurchaseLimitConfigView {
  prisoner: EffectivePurchaseLimits;
  visitor: EffectivePurchaseLimits;
}

function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: string; driverError?: { code?: string } };
  return value?.code === '23505' || value?.driverError?.code === '23505';
}

@Injectable()
export class PurchaseLimitConfigService {
  constructor(
    @InjectRepository(PurchaseLimitConfig)
    private readonly repo: Repository<PurchaseLimitConfig>,
  ) {}

  async getGlobal(manager?: EntityManager): Promise<PurchaseLimitConfig> {
    const repo = manager?.getRepository(PurchaseLimitConfig) ?? this.repo;
    const existing = await repo.findOne({
      where: { singleton: true },
      ...(manager ? sqliteSafeLock('pessimistic_read') : {}),
    });
    if (existing) return existing;

    // Amount defaults use 0 (not null) because the SQLite migration defines these
    // columns as NOT NULL DEFAULT 0, even though the entity allows null for Postgres.
    const row = repo.create({
      singleton: true,
      prisonerFoodEnabled: true,
      prisonerFoodAmount: 100_000,
      prisonerEssentialEnabled: false,
      prisonerEssentialAmount: 0,
      visitorFoodEnabled: true,
      visitorFoodAmount: 500_000,
      visitorEssentialEnabled: false,
      visitorEssentialAmount: 0,
    });
    try {
      return await repo.save(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await repo.findOne({
          where: { singleton: true },
          ...(manager ? sqliteSafeLock('pessimistic_read') : {}),
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  async getEffective(
    audience: PurchaseLimitAudience,
    manager?: EntityManager,
  ): Promise<EffectivePurchaseLimits> {
    const view = this.toView(await this.getGlobal(manager));
    return view[audience];
  }

  async updateGlobal(dto: UpdatePurchaseLimitConfigDto): Promise<PurchaseLimitConfig> {
    const current = await this.getGlobal();
    const candidate = this.repo.create({
      ...current,
      prisonerFoodEnabled: dto.prisoner.food.enabled,
      prisonerFoodAmount: this.nextAmount(dto.prisoner.food, current.prisonerFoodAmount),
      prisonerEssentialEnabled: dto.prisoner.essential.enabled,
      prisonerEssentialAmount: this.nextAmount(dto.prisoner.essential, current.prisonerEssentialAmount),
      visitorFoodEnabled: dto.visitor.food.enabled,
      visitorFoodAmount: this.nextAmount(dto.visitor.food, current.visitorFoodAmount),
      visitorEssentialEnabled: dto.visitor.essential.enabled,
      visitorEssentialAmount: this.nextAmount(dto.visitor.essential, current.visitorEssentialAmount),
    });
    this.validate(candidate);
    return this.repo.save(candidate);
  }

  toView(row: PurchaseLimitConfig): PurchaseLimitConfigView {
    return {
      prisoner: {
        food: { enabled: row.prisonerFoodEnabled, amount: row.prisonerFoodAmount },
        essential: { enabled: row.prisonerEssentialEnabled, amount: row.prisonerEssentialAmount },
      },
      visitor: {
        food: { enabled: row.visitorFoodEnabled, amount: row.visitorFoodAmount },
        essential: { enabled: row.visitorEssentialEnabled, amount: row.visitorEssentialAmount },
      },
    };
  }

  private nextAmount(rule: PurchaseLimitRule, current: number | null): number | null {
    return !rule.enabled && rule.amount === null && current !== null ? current : rule.amount;
  }

  private validate(row: PurchaseLimitConfig): void {
    for (const [name, rule] of Object.entries({
      prisonerFood: { enabled: row.prisonerFoodEnabled, amount: row.prisonerFoodAmount },
      prisonerEssential: { enabled: row.prisonerEssentialEnabled, amount: row.prisonerEssentialAmount },
      visitorFood: { enabled: row.visitorFoodEnabled, amount: row.visitorFoodAmount },
      visitorEssential: { enabled: row.visitorEssentialEnabled, amount: row.visitorEssentialAmount },
    })) {
      if (rule.enabled && rule.amount === null) {
        throw new BadRequestException({ message: `${name}.amount is required when enabled`, code: 'PURCHASE_LIMIT.AMOUNT_REQUIRED' });
      }
      if (rule.amount !== null && (!Number.isInteger(rule.amount) || rule.amount < 1 || rule.amount > MAX_VND)) {
        throw new BadRequestException({ message: `${name}.amount must be an integer from 1 to ${MAX_VND}`, code: 'PURCHASE_LIMIT.AMOUNT_INVALID' });
      }
    }
  }
}
