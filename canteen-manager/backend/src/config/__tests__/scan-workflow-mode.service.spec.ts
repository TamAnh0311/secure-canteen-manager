import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { AppEnv } from '../env-validation';
import { ScanWorkflowMode, ScanWorkflowModeService } from '../scan-workflow-mode.service';

function service(mode: ScanWorkflowMode): ScanWorkflowModeService {
  return new ScanWorkflowModeService({
    get: jest.fn().mockReturnValue(mode),
  } as unknown as ConfigService<AppEnv, true>);
}

function expectConflictCode(action: () => void, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code });
  }
}

describe('ScanWorkflowModeService', () => {
  it.each([
    ['legacy_omr', false, false, true],
    ['scanner_shadow', true, false, true],
    ['scanner_webhook', true, true, false],
  ] as const)(
    'maps %s to review=%s scanner-confirm=%s omr-runtime=%s',
    (mode, scannerReviewEnabled, scannerConfirmationEnabled, omrRuntimeEnabled) => {
      const workflow = service(mode);
      expect(workflow.scannerReviewEnabled).toBe(scannerReviewEnabled);
      expect(workflow.scannerConfirmationEnabled).toBe(scannerConfirmationEnabled);
      expect(workflow.omrRuntimeEnabled).toBe(omrRuntimeEnabled);
    },
  );

  it.each(['legacy_omr', 'scanner_shadow'] as const)(
    'blocks scanner confirmation in %s',
    (mode) => {
      expectConflictCode(
        () => service(mode).assertScannerConfirmationEnabled(),
        'SCAN_WORKFLOW.SCANNER_CONFIRM_DISABLED',
      );
    },
  );

  it('blocks every active OMR mutation and money path in scanner_webhook', () => {
    const workflow = service('scanner_webhook');
    expectConflictCode(() => workflow.assertOmrIntakeEnabled(), 'SCAN_WORKFLOW.OMR_INTAKE_DISABLED');
    expectConflictCode(() => workflow.assertOmrConfirmationEnabled(), 'SCAN_WORKFLOW.OMR_CONFIRM_DISABLED');
    expectConflictCode(() => workflow.assertOmrFormMutationEnabled(), 'SCAN_WORKFLOW.OMR_FORMS_DISABLED');
  });
});
