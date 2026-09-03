import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ThresholdConfigService } from '../threshold-config.service';
import { ThresholdConfig } from '../threshold-config.entity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<Repository<ThresholdConfig>> = {}) {
  return {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<ThresholdConfig>) => ({ ...data } as ThresholdConfig)),
    save: jest.fn(async (entity: ThresholdConfig) => entity),
    ...overrides,
  } as unknown as Repository<ThresholdConfig>;
}

function makeConfigService(vals: Record<string, number> = {}) {
  const defaults: Record<string, number> = {
    ICR_CONFIDENCE_THRESHOLD: 0.85,
    OMR_EMPTY_MAX: 0.30,
    OMR_TICKED_MIN: 0.70,
    DIGIT_BOX_COUNT: 6,
    ...vals,
  };
  return {
    get: jest.fn((key: string) => defaults[key]),
  } as unknown as ConfigService;
}

function makeGlobalRow(overrides: Partial<ThresholdConfig> = {}): ThresholdConfig {
  return {
    id: 'cfg-1',
    icrThreshold: 0.85,
    omrEmptyMax: 0.30,
    omrTickedMin: 0.70,
    digitBoxCount: 6,
    updatedAt: new Date(),
    ...overrides,
  } as ThresholdConfig;
}

function buildService(
  repoOverrides: Partial<Repository<ThresholdConfig>> = {},
  cfgVals: Record<string, number> = {},
) {
  const repo = makeRepo(repoOverrides);
  const cfg = makeConfigService(cfgVals);
  const svc = new ThresholdConfigService(repo, cfg as never);
  return { svc, repo, cfg };
}

// ---------------------------------------------------------------------------
// getGlobal — seed behaviour
// ---------------------------------------------------------------------------

describe('ThresholdConfigService.getGlobal()', () => {
  it('returns the existing row when one is present without seeding', async () => {
    const existing = makeGlobalRow();
    const { svc, repo } = buildService({ findOne: jest.fn().mockResolvedValue(existing) });

    const result = await svc.getGlobal();

    expect(result).toBe(existing);
    expect((repo.save as jest.Mock).mock.calls).toHaveLength(0); // no upsert triggered
  });

  it('seeds from env defaults when no row exists yet', async () => {
    const { svc, repo } = buildService(
      { findOne: jest.fn().mockResolvedValue(null) },
      { ICR_CONFIDENCE_THRESHOLD: 0.9, OMR_EMPTY_MAX: 0.25, OMR_TICKED_MIN: 0.75, DIGIT_BOX_COUNT: 8 },
    );

    const result = await svc.getGlobal();

    expect((repo.save as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(result.icrThreshold).toBe(0.9);
    expect(result.omrEmptyMax).toBe(0.25);
    expect(result.omrTickedMin).toBe(0.75);
    expect(result.digitBoxCount).toBe(8);
  });

  it('recovers the winner row when a concurrent seed loses the singleton race (23505)', async () => {
    const winner = makeGlobalRow();
    // First findOne (pre-insert) sees nothing; the save loses the race and raises 23505;
    // the recovery findOne returns the row the winning caller already committed.
    const findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const save = jest.fn().mockRejectedValue({ code: '23505' });
    const { svc } = buildService({ findOne, save });

    const result = await svc.getGlobal();

    expect(result).toBe(winner);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-unique save errors instead of masking them', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const save = jest.fn().mockRejectedValue({ code: '23502' }); // not_null_violation
    const { svc } = buildService({ findOne, save });

    await expect(svc.getGlobal()).rejects.toEqual({ code: '23502' });
  });
});

// ---------------------------------------------------------------------------
// resolve() — reads the single global config row (no per-form overrides)
// ---------------------------------------------------------------------------

describe('ThresholdConfigService.resolve()', () => {
  it('returns the global row values', async () => {
    const global = makeGlobalRow();
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });

    const result = await svc.resolve();

    expect(result).toEqual({
      digitBoxCount: 6,
      omrEmptyMax: 0.30,
      omrTickedMin: 0.70,
      icrThreshold: 0.85,
    });
  });

  it('reflects custom global values for every field', async () => {
    const global = makeGlobalRow({
      digitBoxCount: 8,
      omrEmptyMax: 0.25,
      omrTickedMin: 0.75,
      icrThreshold: 0.90,
    });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });

    const result = await svc.resolve();

    expect(result).toEqual({
      digitBoxCount: 8,
      omrEmptyMax: 0.25,
      omrTickedMin: 0.75,
      icrThreshold: 0.90,
    });
  });

  it('seeds the global row from env defaults when none exists yet', async () => {
    const { svc, repo } = buildService(
      { findOne: jest.fn().mockResolvedValue(null) },
      { ICR_CONFIDENCE_THRESHOLD: 0.9, OMR_EMPTY_MAX: 0.25, OMR_TICKED_MIN: 0.75, DIGIT_BOX_COUNT: 8 },
    );

    const result = await svc.resolve();

    expect((repo.save as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      digitBoxCount: 8,
      omrEmptyMax: 0.25,
      omrTickedMin: 0.75,
      icrThreshold: 0.90,
    });
  });
});

// ---------------------------------------------------------------------------
// Band boundary cases — OMR fill-band classification at exactly 0.30 and 0.70
//
// Rule:  fill <= omrEmptyMax → empty
//        fill >= omrTickedMin → ticked
//        omrEmptyMax < fill < omrTickedMin → FLAG band
//
// These tests verify that threshold values (defaults: empty_max=0.30, ticked_min=0.70)
// are returned verbatim from the global row so the OMR service can apply them.  The
// boundary values are purely numeric — the FLAG band is [0.30 exclusive, 0.70 exclusive].
// ---------------------------------------------------------------------------

describe('ThresholdConfigService.resolve() — band boundary values', () => {
  it('resolved omrEmptyMax is exactly 0.30 with default config', async () => {
    const global = makeGlobalRow({ omrEmptyMax: 0.30 });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const { omrEmptyMax } = await svc.resolve();
    expect(omrEmptyMax).toBe(0.30);
  });

  it('resolved omrTickedMin is exactly 0.70 with default config', async () => {
    const global = makeGlobalRow({ omrTickedMin: 0.70 });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const { omrTickedMin } = await svc.resolve();
    expect(omrTickedMin).toBe(0.70);
  });

  it('ICR softmax default is exactly 0.85', async () => {
    const global = makeGlobalRow({ icrThreshold: 0.85 });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const { icrThreshold } = await svc.resolve();
    expect(icrThreshold).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// updateGlobal — validation rules
// ---------------------------------------------------------------------------

describe('ThresholdConfigService.updateGlobal()', () => {
  it('rejects when omrEmptyMax >= omrTickedMin (equal)', async () => {
    const global = makeGlobalRow({ omrEmptyMax: 0.50, omrTickedMin: 0.70 });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    // Attempt to set emptyMax equal to tickedMin
    const err = await svc.updateGlobal({ omrEmptyMax: 0.70 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.OMR_THRESHOLD_ORDER' });
  });

  it('rejects when omrEmptyMax > omrTickedMin (inverted)', async () => {
    const global = makeGlobalRow({ omrEmptyMax: 0.30, omrTickedMin: 0.70 });
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const err = await svc.updateGlobal({ omrEmptyMax: 0.80 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.OMR_THRESHOLD_ORDER' });
  });

  it('accepts valid update that keeps omrEmptyMax strictly below omrTickedMin', async () => {
    const global = makeGlobalRow();
    const { svc, repo } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    await expect(svc.updateGlobal({ omrEmptyMax: 0.25, omrTickedMin: 0.75 })).resolves.toBeDefined();
    expect((repo.save as jest.Mock)).toHaveBeenCalled();
  });

  it('rejects icrThreshold outside 0..1', async () => {
    const global = makeGlobalRow();
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const errHigh = await svc.updateGlobal({ icrThreshold: 1.01 }).catch((e: unknown) => e);
    expect(errHigh).toBeInstanceOf(BadRequestException);
    expect((errHigh as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.ICR_THRESHOLD_RANGE' });
    const errLow = await svc.updateGlobal({ icrThreshold: -0.01 }).catch((e: unknown) => e);
    expect(errLow).toBeInstanceOf(BadRequestException);
    expect((errLow as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.ICR_THRESHOLD_RANGE' });
  });

  it('rejects digitBoxCount outside 4..10', async () => {
    const global = makeGlobalRow();
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(global) });
    const errLow = await svc.updateGlobal({ digitBoxCount: 3 }).catch((e: unknown) => e);
    expect(errLow).toBeInstanceOf(BadRequestException);
    expect((errLow as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.DIGIT_BOX_COUNT_RANGE' });
    const errHigh = await svc.updateGlobal({ digitBoxCount: 11 }).catch((e: unknown) => e);
    expect(errHigh).toBeInstanceOf(BadRequestException);
    expect((errHigh as BadRequestException).getResponse()).toMatchObject({ code: 'CONFIG.DIGIT_BOX_COUNT_RANGE' });
  });

  it('admin override of icrThreshold to 0.90 changes the resolved value', async () => {
    // Verify: after updating global icrThreshold, resolve() reflects the new value.
    // Simulates admin changing threshold — subsequent scans use the new value.
    const global = makeGlobalRow({ icrThreshold: 0.85 });
    let storedGlobal = global;
    const repo = makeRepo({
      findOne: jest.fn().mockImplementation(() => Promise.resolve(storedGlobal)),
      save: jest.fn(async (entity: ThresholdConfig) => {
        storedGlobal = entity;
        return entity;
      }) as unknown as Repository<ThresholdConfig>['save'],
    });
    const svc = new ThresholdConfigService(repo, makeConfigService() as never);

    await svc.updateGlobal({ icrThreshold: 0.90 });
    const resolved = await svc.resolve();
    expect(resolved.icrThreshold).toBe(0.90);
  });
});

// ---------------------------------------------------------------------------
// getRoi / saveRoi — global form template on the single row
// ---------------------------------------------------------------------------

describe('ThresholdConfigService roi template', () => {
  it('saveRoi then getRoi round-trips on the single row (no split-row null)', async () => {
    let stored = makeGlobalRow({ roiTemplate: null, roiVersion: null, roiGeneratedAt: null });
    const repo = makeRepo({
      findOne: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      save: jest.fn(async (entity: ThresholdConfig) => {
        stored = entity;
        return entity;
      }) as unknown as Repository<ThresholdConfig>['save'],
    });
    const svc = new ThresholdConfigService(repo, makeConfigService() as never);

    const template = { rois: [{ position: 0 }] };
    const saved = await svc.saveRoi(template, 'v1');
    expect(saved.roiTemplate).toEqual(template);
    expect(saved.roiVersion).toBe('v1');
    expect(saved.roiGeneratedAt).toBeInstanceOf(Date);

    const fetched = await svc.getRoi();
    expect(fetched.roiTemplate).toEqual(template);
    expect(fetched.roiVersion).toBe('v1');
    expect(fetched.roiGeneratedAt).toBe(saved.roiGeneratedAt);
  });

  it('getRoi seeds the row when absent and reports no form generated yet', async () => {
    const { svc } = buildService({ findOne: jest.fn().mockResolvedValue(null) });
    const roi = await svc.getRoi();
    // A freshly seeded row carries no generated stamp — the fail-closed guard reads this as
    // "not yet generated" (`!= null` is false).
    expect(roi.roiGeneratedAt == null).toBe(true);
  });
});
