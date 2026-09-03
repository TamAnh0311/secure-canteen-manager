import { IssuedOmrForm, IssuedOmrFormStatus } from '../../omr-forms/issued-omr-form.entity';
import { SheetStatus } from '../sheet-status.enum';
import { OmrOperationalFormMode, Sheet } from '../sheet.entity';
import { OmrFormMode, OmrFormOrientation } from '../../omr-forms/omr-form-template.entity';
import {
  FORM_TOKEN,
  GENERIC_TEMPLATE_ID,
  buildService,
  drainQueue,
  makeGenericTemplate,
  makeIssuedForm,
  makeOmrResult,
  makeSheet,
  makeUser,
} from './scan-processor.test-setup';

describe('ScanProcessorService — generic identity remains candidates-only', () => {
  it('stores bounded evidence and ranked candidates without proposal, final identity, order, or debit', async () => {
    const { svc, deps } = buildService();
    const reference = `CM-G1:${GENERIC_TEMPLATE_ID}`;
    const template = makeGenericTemplate();
    const candidate = makeUser({
      id: 'candidate-user',
      legacyId: 'P-004218',
      name: 'Nguyễn Văn An',
      zone: 'Khu A',
      cell: 'A-01',
    });
    const sheet = makeSheet({
      admittedMode: OmrOperationalFormMode.GENERIC,
      admittedBy: 'operator-uuid-1',
    });
    deps.registerSheet(sheet);
    deps.setGenericTemplate(template);
    deps.omrClient.identifyFormToken.mockResolvedValue({
      form_token: null,
      form_reference: reference,
      flags: [],
    });
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult({
      form_token: null,
      form_reference: reference,
      handwriting_fields: [
        { field: 'name', status: 'recognized', raw_text: 'Nguyễn Văn An', confidence: 0.8, raw_score: 0.7, flags: [] },
        { field: 'cell', status: 'recognized', raw_text: 'A-01', confidence: 0.9, raw_score: 0.8, flags: [] },
        { field: 'prisoner_id', status: 'blank', raw_text: null, confidence: null, raw_score: null, flags: [] },
      ],
      handwriting_model: null,
    }));
    deps.usersService.findActiveByExactCell.mockResolvedValue([candidate]);

    const final = await drainQueue(svc, deps, sheet.id);

    expect(deps.usersService.findActiveByExactCell).toHaveBeenCalledWith(
      'A-01',
      expect.objectContaining({ id: 'operator-uuid-1' }),
    );
    expect(final.status).toBe(SheetStatus.FLAGGED);
    expect(final.templateId).toBe(GENERIC_TEMPLATE_ID);
    expect(final.identityEvidenceJson).toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ field: 'cell', raw_text: 'A-01' })]),
      evidenceFingerprint: expect.any(String),
    });
    expect(final.rankedCandidatesJson).toMatchObject({
      candidates: [expect.objectContaining({ userId: candidate.id, reasons: expect.arrayContaining(['CELL_EXACT']) })],
    });
    expect(final.proposedUserId).toBeNull();
    expect(final.matchedUserId).toBeNull();
    expect(final.orderId).toBeNull();
  });
});

describe('ScanProcessorService — issued QR is the sole identity authority', () => {
  it('maps full-list quantity evidence by immutable template row, not current menu order', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    const form = makeIssuedForm();
    form.formMode = OmrFormMode.FULL_LIST;
    form.template.mode = OmrFormMode.FULL_LIST;
    form.template.orientation = OmrFormOrientation.LANDSCAPE;
    form.template.rows = [{
      id: 'row-1',
      templateId: form.templateId,
      rowIndex: 0,
      menuItemId: 'immutable-menu-item',
      codeSnapshot: '017',
      shortLabelSnapshot: 'Sua hop',
      position: 42,
    }] as typeof form.template.rows;
    deps.setIssuedForm(form);
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult({
      order_lines: [{
        line_index: 0,
        code: null,
        qty: 2,
        code_digits: [],
        qty_digits: [],
        flags: [],
      }],
    }));

    const final = await drainQueue(svc, deps, sheet.id);
    expect(final.resultJson).toMatchObject({
      order_lines: [{
        line_index: 0,
        menu_item_id: 'immutable-menu-item',
        code_snapshot: '017',
        name_snapshot: 'Sua hop',
        qty: 2,
      }],
    });
  });

  it('locks the issued form before any sheet so second-scan conflict cannot invert confirm order', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult());

    await drainQueue(svc, deps, sheet.id);

    const writeLocks = deps.manager.findOne.mock.calls
      .filter(([, options]) => options?.lock?.mode === 'pessimistic_write')
      .map(([entity]) => entity);
    expect(writeLocks.slice(0, 2)).toEqual([IssuedOmrForm, Sheet]);
  });

  it('uses the issued token prisoner even when recognized_id claims another prisoner', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    const tokenOwner = makeUser({ id: 'token-owner', legacyId: 'P-004218' });
    deps.registerSheet(sheet);
    deps.setIssuedForm(makeIssuedForm({ userId: tokenOwner.id, user: tokenOwner }));
    deps.omrClient.processScan.mockResolvedValue(
      makeOmrResult({ recognized_id: 'P-ATTACKER' }),
    );
    deps.usersService.findByLegacyId.mockResolvedValue(
      makeUser({ id: 'attacker', legacyId: 'P-ATTACKER' }),
    );

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.FLAGGED);
    expect(final.matchedUserId).toBe(tokenOwner.id);
    expect(final.issuedFormId).toBe(FORM_TOKEN);
    expect(final.recognizedId).toBeNull();
    expect(final.orderId).toBeNull();
    expect(deps.usersService.findByLegacyId).not.toHaveBeenCalled();
  });

  it('rejects a missing token and never falls back to a readable handwritten ID', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.identifyFormToken.mockResolvedValue({ form_token: null, flags: ['QR_NOT_FOUND'] });
    deps.usersService.findByLegacyId.mockResolvedValue(makeUser());

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.matchedUserId).toBeNull();
    expect(final.issuedFormId).toBeNull();
    expect(final.flags).toContain('QR_NOT_FOUND');
    expect(deps.usersService.findByLegacyId).not.toHaveBeenCalled();
  });

  it('strips bearer-token and handwritten identity material from persisted audit JSON', async () => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.omrClient.processScan.mockResolvedValue(
      makeOmrResult({ recognized_id: 'P-ATTACKER' }),
    );

    const final = await drainQueue(svc, deps, sheet.id);
    const serialized = JSON.stringify(final.resultJson);

    expect(serialized).not.toContain(FORM_TOKEN);
    expect(final.resultJson).not.toHaveProperty('form_token');
    expect(final.resultJson).not.toHaveProperty('recognized_id');
    expect(final.resultJson).not.toHaveProperty('id_digits');
    expect(final.resultJson).toMatchObject({
      order_lines: expect.any(Array),
      avg_confidence: 0.95,
      warp_ok: true,
    });
  });

  it.each([
    {
      label: 'random token',
      form: null,
      expectedFlag: 'FORM_TOKEN_NOT_FOUND',
    },
    {
      label: 'void token',
      form: makeIssuedForm({ status: IssuedOmrFormStatus.VOID }),
      expectedFlag: 'FORM_TOKEN_VOID',
    },
    {
      label: 'consumed token',
      form: makeIssuedForm({
        status: IssuedOmrFormStatus.CONSUMED,
        consumedSheetId: 'already-confirmed',
      }),
      expectedFlag: 'FORM_TOKEN_CONSUMED',
    },
    {
      label: 'stale-date token',
      form: makeIssuedForm({ serviceDate: '2026-07-14' }),
      expectedFlag: 'FORM_TOKEN_DATE_MISMATCH',
    },
    {
      label: 'wrong-template token',
      form: makeIssuedForm({ templateId: 'different-template' }),
      expectedFlag: 'FORM_TOKEN_TEMPLATE_MISMATCH',
    },
    {
      label: 'inactive-prisoner token',
      form: makeIssuedForm({ user: makeUser({ isActive: false }) }),
      expectedFlag: 'FORM_TOKEN_USER_INACTIVE',
    },
  ])('terminally rejects a $label without matching a user or order', async ({ form, expectedFlag }) => {
    const { svc, deps } = buildService();
    const sheet = makeSheet();
    deps.registerSheet(sheet);
    deps.setIssuedForm(form);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult());

    const final = await drainQueue(svc, deps, sheet.id);

    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(final.flags).toContain(expectedFlag);
    expect(final.matchedUserId).toBeNull();
    expect(final.orderId).toBeNull();
    expect(deps.usersService.findByLegacyId).not.toHaveBeenCalled();
  });
});

describe('ScanProcessorService — same-token conflict quarantine', () => {
  it('voids the form and rejects both distinct-checksum candidates in one transaction', async () => {
    const { svc, deps } = buildService();
    const first = makeSheet({
      id: 'sheet-first',
      checksum: 'a'.repeat(64),
      status: SheetStatus.FLAGGED,
      issuedFormId: FORM_TOKEN,
      matchedUserId: 'user-uuid-1',
    });
    const second = makeSheet({
      id: 'sheet-second',
      checksum: 'b'.repeat(64),
    });
    const form = makeIssuedForm({ reservedSheetId: first.id });
    deps.registerSheet(first);
    deps.registerSheet(second);
    deps.setIssuedForm(form);
    deps.omrClient.processScan.mockResolvedValue(makeOmrResult());

    const final = await drainQueue(svc, deps, second.id);

    expect(deps.dataSource.transaction).toHaveBeenCalledTimes(1);
    const writeLocks = deps.manager.findOne.mock.calls
      .filter(([, options]) => options?.lock?.mode === 'pessimistic_write')
      .map(([entity]) => entity);
    expect(writeLocks.slice(0, 2)).toEqual([IssuedOmrForm, Sheet]);
    expect(form.status).toBe(IssuedOmrFormStatus.VOID);
    expect(form.voidReason).toBe('TOKEN_CHECKSUM_CONFLICT');
    expect(first.status).toBe(SheetStatus.REJECTED);
    expect(second.status).toBe(SheetStatus.REJECTED);
    expect(final.status).toBe(SheetStatus.REJECTED);
    expect(first.matchedUserId).toBeNull();
    expect(second.matchedUserId).toBeNull();
    expect(first.flags).toContain('FORM_TOKEN_CONFLICT');
    expect(second.flags).toContain('FORM_TOKEN_CONFLICT');
  });
});
