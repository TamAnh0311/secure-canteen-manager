import { MenuController } from '../menu.controller';
import { MenuService } from '../menu.service';
import { MenuItemSummary } from '../menu.service';
import { ThresholdConfigService } from '../../config/threshold-config.service';
import { OmrClientService } from '../../omr/omr-client.service';
import { OmrFormTemplatesService } from '../../omr-forms/omr-form-templates.service';
import { ScanWorkflowModeService } from '../../config/scan-workflow-mode.service';

function harness() {
  const menuService = {
    listAll: jest.fn().mockResolvedValue([]),
    getSummary: jest.fn().mockResolvedValue([]),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
    reorder: jest.fn(),
    activeCatalogSnapshot: jest.fn().mockResolvedValue([]),
    assertCodesFitForm: jest.fn().mockResolvedValue(undefined),
    scannerCatalogueExport: jest.fn().mockResolvedValue({ schemaVersion: 'scanner-catalogue-v1', version: '', items: [] }),
  };
  const thresholdConfig = { getRoi: jest.fn().mockResolvedValue({ roiTemplate: null, roiVersion: null, roiGeneratedAt: null }) };
  const omrClient = { generateA5Template: jest.fn() };
  const templatesService = { getActiveTemplates: jest.fn().mockResolvedValue([]) };
  const workflowMode = { assertOmrFormMutationEnabled: jest.fn() };
  return {
    controller: new MenuController(
      menuService as unknown as MenuService,
      thresholdConfig as unknown as ThresholdConfigService,
      omrClient as unknown as OmrClientService,
      templatesService as unknown as OmrFormTemplatesService,
      workflowMode as unknown as ScanWorkflowModeService,
    ),
    menuService,
  };
}

describe('MenuController', () => {
  it('delegates list() to menuService.listAll()', async () => {
    const h = harness();
    await h.controller.list();
    expect(h.menuService.listAll).toHaveBeenCalled();
  });

  it('delegates summary() to menuService.getSummary() with the query date', async () => {
    const h = harness();
    const mockReq = { user: { id: 'op-1' } } as any;
    await h.controller.summary({ date: '2026-06-18' }, mockReq);
    expect(h.menuService.getSummary).toHaveBeenCalledWith('2026-06-18', mockReq.user);
  });

  it('delegates reorder() to menuService.reorder()', async () => {
    const h = harness();
    const ids = ['id-1', 'id-2'];
    await h.controller.reorder({ orderedItemIds: ids });
    expect(h.menuService.reorder).toHaveBeenCalledWith(ids);
  });
});
