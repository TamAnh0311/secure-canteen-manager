import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './env-validation';

export type ScanWorkflowMode = AppEnv['SCAN_WORKFLOW_MODE'];

@Injectable()
export class ScanWorkflowModeService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get mode(): ScanWorkflowMode {
    return this.config.get('SCAN_WORKFLOW_MODE', { infer: true });
  }

  get scannerReviewEnabled(): boolean {
    return this.mode !== 'legacy_omr';
  }

  get scannerConfirmationEnabled(): boolean {
    return this.mode === 'scanner_webhook';
  }

  get omrRuntimeEnabled(): boolean {
    return this.mode !== 'scanner_webhook';
  }

  assertScannerConfirmationEnabled(): void {
    if (this.scannerConfirmationEnabled) return;
    throw new ConflictException({
      message: 'Scanner confirmation is disabled in the current workflow mode',
      code: 'SCAN_WORKFLOW.SCANNER_CONFIRM_DISABLED',
    });
  }

  assertOmrIntakeEnabled(): void {
    if (this.omrRuntimeEnabled) return;
    throw new ConflictException({
      message: 'OMR intake is disabled in scanner webhook mode',
      code: 'SCAN_WORKFLOW.OMR_INTAKE_DISABLED',
    });
  }

  assertOmrConfirmationEnabled(): void {
    if (this.omrRuntimeEnabled) return;
    throw new ConflictException({
      message: 'OMR confirmation is disabled in scanner webhook mode',
      code: 'SCAN_WORKFLOW.OMR_CONFIRM_DISABLED',
    });
  }

  assertOmrFormMutationEnabled(): void {
    if (this.omrRuntimeEnabled) return;
    throw new ConflictException({
      message: 'OMR form generation is disabled in scanner webhook mode',
      code: 'SCAN_WORKFLOW.OMR_FORMS_DISABLED',
    });
  }
}
