import { DataSource } from 'typeorm';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { OmrClientService } from '../../omr/omr-client.service';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { UsersService } from '../../users/users.service';
import { OmrFormMode, OmrFormOrientation } from '../omr-form-template.entity';
import { OmrFormTemplatesService } from '../omr-form-templates.service';
import { IssuedOmrFormBatchPrint, OmrFormsService } from '../omr-forms.service';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ISSUER_ID = '22222222-2222-4222-8222-222222222222';
const ISSUED_AT = new Date('2026-07-14T10:00:00.000Z');
const ACTOR = {
  id: ISSUER_ID,
  role: OperatorRole.OPERATOR,
  zone: 'Khu A',
} as OperatorPublic;

function service() {
  return new OmrFormsService(
    {} as DataSource,
    {} as UsersService,
    {} as OmrClientService,
    {} as OmrFormTemplatesService,
    {} as OperatorZoneAccessService,
    { assertOmrFormMutationEnabled: jest.fn() } as unknown as ScanWorkflowModeService,
  );
}

describe('OmrFormsService single-issue compatibility adapter', () => {
  it('delegates to the code-mode one-person batch and preserves the legacy token-free response', async () => {
    const svc = service();
    const batch = {
      serviceDate: '2026-07-15',
      issuedAt: ISSUED_AT,
      mode: OmrFormMode.CODE,
      orientation: OmrFormOrientation.PORTRAIT,
      pageCount: 1,
      manifest: [{ userId: USER_ID, shortSerial: 'ABCDEF12' }],
      pdfBase64: 'JVBERi0xLjQ=',
    } satisfies IssuedOmrFormBatchPrint;
    const issueBatch = jest.spyOn(svc, 'issueBatch').mockResolvedValue(batch);

    await expect(svc.issue(USER_ID, ACTOR)).resolves.toEqual({
      serial: 'ABCDEF12',
      serviceDate: '2026-07-15',
      issuedAt: ISSUED_AT,
      pdfBase64: 'JVBERi0xLjQ=',
    });
    expect(issueBatch).toHaveBeenCalledWith(
      { userIds: [USER_ID], mode: OmrFormMode.CODE },
      ACTOR,
    );
    expect(await svc.issue(USER_ID, ACTOR)).not.toHaveProperty('token');
  });
});
