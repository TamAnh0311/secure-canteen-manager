import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ThresholdConfig } from './threshold-config.entity';
import { AppEnv } from './env-validation';

export interface ResolvedThresholds {
  digitBoxCount: number;
  omrEmptyMax: number;
  omrTickedMin: number;
  icrThreshold: number;
}

export interface UpdateThresholdsDto {
  icrThreshold?: number;
  omrEmptyMax?: number;
  omrTickedMin?: number;
  digitBoxCount?: number;
}

export interface RoiState {
  roiTemplate: object | null;
  roiVersion: string | null;
  roiGeneratedAt: Date | null;
}

// The ROI template version this backend release understands. scan-processor guards every
// incoming scan against this constant: a stored template whose roi_version differs means the
// form layout was generated for a different release and its coordinates or identity contract
// cannot be decoded safely. Physical v2 sheets are rejected because v3 requires an issued-form
// QR in the configured crop; rollout still withdraws old paper to avoid needless rejections.
export const EXPECTED_ROI_VERSION = 'v3';

// Postgres unique-violation SQLSTATE. TypeORM surfaces it on the error itself or its
// nested driverError depending on the failure path.
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23505' || err?.driverError?.code === '23505';
}

@Injectable()
export class ThresholdConfigService {
  constructor(
    @InjectRepository(ThresholdConfig)
    private readonly repo: Repository<ThresholdConfig>,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {}

  // Lazy seed: returns the single global config row, creating it from env defaults if absent.
  async getGlobal(): Promise<ThresholdConfig> {
    const existing = await this.repo.findOne({ where: {} });
    if (existing) return existing;

    // Seed from env defaults on first call. The singleton UNIQUE constraint means two
    // concurrent first-callers race here; the loser's insert raises 23505 — recover by
    // re-reading the row the winner committed, so a cold-start race never surfaces a 500
    // on the OMR config path.
    const row = this.repo.create({
      icrThreshold: this.configService.get('ICR_CONFIDENCE_THRESHOLD', { infer: true }),
      omrEmptyMax: this.configService.get('OMR_EMPTY_MAX', { infer: true }),
      omrTickedMin: this.configService.get('OMR_TICKED_MIN', { infer: true }),
      digitBoxCount: this.configService.get('DIGIT_BOX_COUNT', { infer: true }),
    });
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

  // Updates the global config row; validates threshold ordering and ranges.
  async updateGlobal(dto: UpdateThresholdsDto): Promise<ThresholdConfig> {
    const row = await this.getGlobal();

    if (dto.icrThreshold !== undefined) row.icrThreshold = dto.icrThreshold;
    if (dto.omrEmptyMax !== undefined) row.omrEmptyMax = dto.omrEmptyMax;
    if (dto.omrTickedMin !== undefined) row.omrTickedMin = dto.omrTickedMin;
    if (dto.digitBoxCount !== undefined) row.digitBoxCount = dto.digitBoxCount;

    this.validate(row);
    return this.repo.save(row);
  }

  // The global OMR form template lives on the single threshold_config row, so the
  // form-generated signal (roiGeneratedAt) can never split across rows. Read via the
  // idempotent get-or-create so a missing row seeds rather than returns null.
  async getRoi(): Promise<RoiState> {
    const row = await this.getGlobal();
    return {
      roiTemplate: row.roiTemplate,
      roiVersion: row.roiVersion,
      roiGeneratedAt: row.roiGeneratedAt,
    };
  }

  // Persists the OMR template + version on the single global row and stamps roiGeneratedAt.
  // The stamp is the one source of truth for "the form has been printed" — it permanently
  // locks menu reorder/rename/hard-delete so a printed checkbox row can never be remapped.
  async saveRoi(roiTemplate: object, roiVersion: string | null): Promise<RoiState> {
    const row = await this.getGlobal();
    row.roiTemplate = roiTemplate;
    row.roiVersion = roiVersion;
    row.roiGeneratedAt = new Date();
    const saved = await this.repo.save(row);
    return {
      roiTemplate: saved.roiTemplate,
      roiVersion: saved.roiVersion,
      roiGeneratedAt: saved.roiGeneratedAt,
    };
  }

  // Resolves recognition thresholds only. Operational ROI/geometry selection is deliberately
  // excluded and must resolve through the issued form's immutable template.
  async resolve(): Promise<ResolvedThresholds> {
    const global = await this.getGlobal();
    return {
      digitBoxCount: global.digitBoxCount,
      omrEmptyMax: global.omrEmptyMax,
      omrTickedMin: global.omrTickedMin,
      icrThreshold: global.icrThreshold,
    };
  }

  private validate(row: ThresholdConfig): void {
    if (row.omrEmptyMax >= row.omrTickedMin) {
      throw new BadRequestException({
        message: 'omrEmptyMax must be strictly less than omrTickedMin',
        code: 'CONFIG.OMR_THRESHOLD_ORDER',
      });
    }
    if (row.omrEmptyMax < 0 || row.omrEmptyMax > 1) {
      throw new BadRequestException({ message: 'omrEmptyMax must be in range 0..1', code: 'CONFIG.OMR_EMPTY_MAX_RANGE' });
    }
    if (row.omrTickedMin < 0 || row.omrTickedMin > 1) {
      throw new BadRequestException({ message: 'omrTickedMin must be in range 0..1', code: 'CONFIG.OMR_TICKED_MIN_RANGE' });
    }
    if (row.icrThreshold < 0 || row.icrThreshold > 1) {
      throw new BadRequestException({ message: 'icrThreshold must be in range 0..1', code: 'CONFIG.ICR_THRESHOLD_RANGE' });
    }
    if (row.digitBoxCount < 4 || row.digitBoxCount > 10) {
      throw new BadRequestException({ message: 'digitBoxCount must be between 4 and 10', code: 'CONFIG.DIGIT_BOX_COUNT_RANGE' });
    }
  }
}
