import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../../config/env-validation';
import { ScanAdmissionSource, OmrOperationalFormMode } from '../../scans/sheet.entity';
import { UsersService } from '../../users/users.service';
import { OmrOperationalModeService } from '../omr-operational-mode.service';

function buildHarness(mode: OmrOperationalFormMode) {
  const config = {
    get: jest.fn((key: keyof AppEnv) => {
      if (key === 'OMR_OPERATIONAL_FORM_MODE') return mode;
      if (key === 'OMR_OPERATIONAL_FORM_GENERATION') return `${mode}-test-v1`;
      return undefined;
    }),
  };
  const users = {
    assertGenericCellIdentityReady: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new OmrOperationalModeService(
      config as unknown as ConfigService<AppEnv, true>,
      users as unknown as UsersService,
    ),
    users,
  };
}

describe('OmrOperationalModeService generic activation guard', () => {
  it('runs the shared cell audit during generic startup and access checks', async () => {
    const { service, users } = buildHarness(OmrOperationalFormMode.GENERIC);

    await service.onApplicationBootstrap();
    await service.assertGenericReady();

    expect(users.assertGenericCellIdentityReady).toHaveBeenCalledTimes(2);
  });

  it('propagates a failed startup audit instead of starting generic mode', async () => {
    const { service, users } = buildHarness(OmrOperationalFormMode.GENERIC);
    users.assertGenericCellIdentityReady.mockRejectedValueOnce(
      new ConflictException({ code: 'OMR_GENERIC.CELL_AUDIT_FAILED' }),
    );

    await expect(service.onApplicationBootstrap()).rejects.toMatchObject({
      response: { code: 'OMR_GENERIC.CELL_AUDIT_FAILED' },
    });
  });

  it('keeps issued startup independent and rejects native intake only in generic mode', async () => {
    const issued = buildHarness(OmrOperationalFormMode.ISSUED);
    await issued.service.onApplicationBootstrap();
    expect(issued.users.assertGenericCellIdentityReady).not.toHaveBeenCalled();
    expect(() => issued.service.assertAdmissionSource(ScanAdmissionSource.AGENT)).not.toThrow();

    const generic = buildHarness(OmrOperationalFormMode.GENERIC);
    expect(() => generic.service.assertAdmissionSource(ScanAdmissionSource.AGENT)).toThrow(
      ConflictException,
    );
    expect(() => generic.service.assertAdmissionSource(ScanAdmissionSource.BROWSER)).not.toThrow();
  });
});
