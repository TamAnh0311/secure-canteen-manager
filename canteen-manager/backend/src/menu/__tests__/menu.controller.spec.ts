import { MenuController } from '../menu.controller';
import { MenuService } from '../menu.service';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import { OmrClientService } from '../../omr/omr-client.service';
import { OmrFormTemplatesService } from '../../omr-forms/omr-form-templates.service';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';
import { OmrFormMode } from '../../omr-forms/omr-form-template.entity';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';

function harness() {
  const catalog = [{
    menuItemId: ITEM_ID,
    codeSnapshot: '001',
    shortLabelSnapshot: 'Com',
    position: 0,
  }];
  const menuService = {
    assertCodesFitForm: jest.fn().mockResolvedValue(undefined),
    activeCatalogSnapshot: jest.fn().mockResolvedValue(catalog),
  };
  const thresholdConfig = {
    getRoi: jest.fn().mockResolvedValue({ roiGeneratedAt: null, roiVersion: null }),
  };
  const omrClient = {
    generateA5Template: jest.fn(async ({ mode, template_revision }: { mode: OmrFormMode; template_revision: string }) => ({
      pdf_base64: `${mode}-pdf`,
      roi_template: {
        schema_version: 'omr-a5-v1',
        mode,
        orientation: mode === OmrFormMode.CODE ? 'portrait' : 'landscape',
        template_revision,
      },
    })),
  };
  const templates = {
    getActiveTemplates: jest.fn().mockResolvedValue([]),
    activateCodeTemplate: jest.fn().mockResolvedValue({}),
    activateFullListTemplate: jest.fn().mockResolvedValue({}),
  };
  return {
    controller: new MenuController(
      menuService as unknown as MenuService,
      thresholdConfig as unknown as ThresholdConfigService,
      omrClient as unknown as OmrClientService,
      templates as unknown as OmrFormTemplatesService,
      { assertOmrFormMutationEnabled: jest.fn() } as unknown as ScanWorkflowModeService,
    ),
    menuService,
    omrClient,
    templates,
  };
}

describe('MenuController A5 calibration forms', () => {
  it('generates and activates the code template without catalog rows', async () => {
    const h = harness();
    await expect(h.controller.generateForm(OmrFormMode.CODE)).resolves.toEqual({ pdfBase64: 'code-pdf' });

    expect(h.omrClient.generateA5Template).toHaveBeenCalledWith(expect.objectContaining({
      mode: OmrFormMode.CODE,
      catalog_rows: [],
    }));
    expect(h.templates.activateCodeTemplate).toHaveBeenCalledWith(expect.objectContaining({
      revision: expect.stringMatching(/^a5-code-/),
      geometry: expect.objectContaining({ orientation: 'portrait' }),
    }));
  });

  it('renders the exact active catalog and activates a full-list template', async () => {
    const h = harness();
    await expect(h.controller.generateForm(OmrFormMode.FULL_LIST)).resolves.toEqual({ pdfBase64: 'full_list-pdf' });

    expect(h.omrClient.generateA5Template).toHaveBeenCalledWith(expect.objectContaining({
      mode: OmrFormMode.FULL_LIST,
      catalog_rows: [{
        row_index: 0,
        menu_item_id: ITEM_ID,
        code_snapshot: '001',
        short_label: 'Com',
      }],
    }));
    expect(h.templates.activateFullListTemplate).toHaveBeenCalledWith(expect.objectContaining({
      revision: expect.stringMatching(/^a5-full_list-/),
      geometry: expect.objectContaining({ orientation: 'landscape' }),
      expectedCatalogHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it('reports independent mode availability and the 52-item full-list cap', async () => {
    const h = harness();
    h.menuService.activeCatalogSnapshot.mockResolvedValue(Array.from({ length: 53 }, (_, index) => ({
      menuItemId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
      codeSnapshot: String(index + 1).padStart(3, '0'),
      shortLabelSnapshot: `Item ${index + 1}`,
      position: index,
    })));

    const status = await h.controller.formStatus();
    expect(status.templates.code.available).toBe(true);
    expect(status.templates.full_list).toMatchObject({
      available: false,
      unavailableReason: 'FORM_TEMPLATE.CAPACITY_EXCEEDED',
      activeItemCount: 53,
      capacity: 52,
    });
  });
});
