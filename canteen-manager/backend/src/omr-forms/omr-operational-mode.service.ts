import { ConflictException, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env-validation';
import { OmrOperationalFormMode, ScanAdmissionSource } from '../scans/sheet.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class OmrOperationalModeService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly users: UsersService,
  ) {}

  get mode(): OmrOperationalFormMode {
    return this.config.get('OMR_OPERATIONAL_FORM_MODE', { infer: true });
  }

  get generation(): string {
    return this.config.get('OMR_OPERATIONAL_FORM_GENERATION', { infer: true });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.mode === OmrOperationalFormMode.GENERIC) {
      await this.users.assertGenericCellIdentityReady();
    }
  }

  assertAdmissionSource(source: ScanAdmissionSource): void {
    if (this.mode === OmrOperationalFormMode.GENERIC && source !== ScanAdmissionSource.BROWSER) {
      throw new ConflictException({
        message: 'Generic OMR software mode accepts browser uploads only',
        code: 'OMR_GENERIC.BROWSER_UPLOAD_REQUIRED',
      });
    }
  }

  async assertGenericReady(): Promise<void> {
    if (this.mode !== OmrOperationalFormMode.GENERIC) return;
    await this.users.assertGenericCellIdentityReady();
  }
}
