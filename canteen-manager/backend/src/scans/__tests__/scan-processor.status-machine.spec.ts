import {
  OmrPermanentError,
  OmrRetryableError,
} from '../../omr/omr-client.service';
import { SheetStatus } from '../sheet-status.enum';
import {
  buildService,
  drainQueue,
  makeIssuedForm,
  makeOmrResult,
  makeSheet,
} from './scan-processor.test-setup';

describe('ScanProcessorService — status state machine', () => {
  it('transitions PENDING → PROCESSING → FLAGGED when a valid issued token is reserved', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult());

    const final = await drainQueue(svc, deps, sheet.id);
    const snapshots = (deps.repo.save as jest.Mock & { _snapshots: SheetStatus[] })._snapshots;

    expect(snapshots).toContain(SheetStatus.PROCESSING);
    expect(final.status).toBe(SheetStatus.FLAGGED);
    expect(final.matchedUserId).toBe('user-uuid-1');
    expect(final.orderId).toBeNull();
    expect(final.processedAt).toBeInstanceOf(Date);
  });

  it('skips processing and all writes when a sheet is already terminal', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet({ status: SheetStatus.VERIFIED });
    deps.registerSheet(sheet);

    svc.enqueue(sheet.id);
    await (svc as unknown as { tail: Promise<void> }).tail;

    expect(deps.repo.save).not.toHaveBeenCalled();
    expect(deps.manager.save).not.toHaveBeenCalled();
    expect(deps.omrClient.processScan).not.toHaveBeenCalled();
  });

  it('identifies raw QR first and decodes against the issued immutable template', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult());

    await drainQueue(svc, deps, sheet.id);

    expect(deps.omrClient.identifyFormToken).toHaveBeenCalledWith('base64data');
    expect(deps.omrClient.processScan).toHaveBeenCalledWith(
      expect.objectContaining({
        roi_template: makeIssuedForm().template.geometry,
        digit_box_count: 0,
        expected_form_token: makeIssuedForm().token,
      }),
    );
    expect(deps.omrClient.identifyFormToken.mock.invocationCallOrder[0]).toBeLessThan(
      deps.omrClient.processScan.mock.invocationCallOrder[0],
    );
  });

  it('rejects before recognition when raw QR is missing', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.identifyFormToken.mockResolvedValue({ form_token: null, flags: ['QR_NOT_FOUND'] });

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('QR_NOT_FOUND');
    expect(deps.omrClient.processScan).not.toHaveBeenCalled();
  });

  it('rejects before recognition when issued template binding is inconsistent', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.setIssuedForm(makeIssuedForm({ templateId: 'different-template' }));

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('FORM_TOKEN_TEMPLATE_MISMATCH');
    expect(deps.omrClient.processScan).not.toHaveBeenCalled();
  });

  it('rejects when raw and post-warp QR tokens differ', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult({
      form_token: '223e4567-e89b-42d3-a456-426614174001',
      flags: ['QR_TOKEN_MISMATCH'],
    }));

    const final = await drainQueue(svc, deps, sheet.id);
    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('QR_TOKEN_MISMATCH');
    expect(deps.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('terminally rejects a deterministic image/token 4xx', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockRejectedValue(
      new OmrPermanentError('OMR.INVALID_IMAGE', 'image cannot be decoded'),
    );

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('OMR.INVALID_IMAGE');
    expect(final.processedAt).toBeInstanceOf(Date);
    expect(final.nextRetryAt).toBeNull();
  });

  it('keeps a network/timeout/5xx failure recoverable with bounded backoff metadata', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T10:00:00.000Z'));
    try {
      const { svc, deps } = buildService();
      const sheet = makeSheet();
      deps.registerSheet(sheet);
      deps.omrClient.processScan.mockRejectedValue(
        new OmrRetryableError('OMR.SERVICE_UNAVAILABLE', 'connection refused'),
      );

      const final = await drainQueue(svc, deps, sheet.id);

      expect(final.status).toBe(SheetStatus.PENDING);
      expect(final.processingAttempts).toBe(1);
      expect(final.nextRetryAt).toBeInstanceOf(Date);
      expect(final.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
      expect(final.processedAt).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('terminally quarantines retryable work when the retry budget is exhausted', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet({ processingAttempts: 2 });
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockRejectedValue(
      new OmrRetryableError('OMR.SERVICE_UNAVAILABLE', 'upstream 503'),
    );

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.processingAttempts).toBe(3);
    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('OMR_RETRY_EXHAUSTED');
    expect(final.nextRetryAt).toBeNull();
    expect(final.processedAt).toBeInstanceOf(Date);
  });

  it('rejects an unusable warp even if the payload contains a syntactically valid token', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(
      makeOmrResult({ warp_ok: false, flags: ['WARP_FAILED'] }),
    );

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain('WARP_FAILED');
    expect(final.matchedUserId).toBeNull();
  });

  it('skips DB writes after shutdown is requested', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);

    svc.onModuleDestroy();
    svc.enqueue(sheet.id);
    await (svc as unknown as { tail: Promise<void> }).tail;

    expect(deps.repo.save).not.toHaveBeenCalled();
    expect(deps.manager.save).not.toHaveBeenCalled();
  });
});
