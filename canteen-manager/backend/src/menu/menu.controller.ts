import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { canonicalCatalogHash, OmrFormTemplatesService } from '../omr-forms/omr-form-templates.service';
import { OmrFormMode, OmrFormOrientation } from '../omr-forms/omr-form-template.entity';
import { MenuService, MenuItemSummary } from './menu.service';
import { ThresholdConfigService } from '../config/threshold-config.service';
import { OmrClientService } from '../omr/omr-client.service';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderMenuDto } from './dto/reorder-menu.dto';
import { MenuSummaryQueryDto } from './dto/menu-summary-query.dto';
import { MenuSummaryRangeQueryDto } from './dto/menu-summary-range-query.dto';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { MenuItem } from './menu-item.entity';
import { OperatorPublic } from '../operators/operator-public';
import { ScanWorkflowModeService } from '../config/scan-workflow-mode.service';

interface AuthRequest {
  user: OperatorPublic;
}

interface FormStatus {
  generatedAt: Date | null;
  version: string | null;
  templates: Record<OmrFormMode, {
    mode: OmrFormMode;
    generatedAt: Date | null;
    version: string | null;
    orientation: OmrFormOrientation;
    available: boolean;
    unavailableReason: string | null;
    activeItemCount: number;
    capacity: number | null;
  }>;
}

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly thresholdConfig: ThresholdConfigService,
    private readonly omrClient: OmrClientService,
    private readonly templatesService: OmrFormTemplatesService,
    private readonly workflowMode: ScanWorkflowModeService,
  ) {}

  /** Staff-readable: the kiosk and counter need the global menu list. */
  @Get()
  list(): Promise<MenuItem[]> {
    return this.menuService.listAll();
  }

  /** Exports the menu catalogue for the external scanner service. */
  @Get('scanner-catalogue')
  @Roles(OperatorRole.ADMIN)
  scannerCatalogue(): ReturnType<MenuService['scannerCatalogueExport']> {
    return this.menuService.scannerCatalogueExport();
  }

  /** Kitchen summary for a single service date (defaults to today). Staff-readable. */
  @Get('summary')
  summary(
    @Query() query: MenuSummaryQueryDto,
    @Req() req: AuthRequest,
  ): Promise<MenuItemSummary[]> {
    return this.menuService.getSummary(query.date, req.user);
  }

  /** Kitchen summary aggregated across a date range (inclusive). Staff-readable. */
  @Get('summary-range')
  summaryRange(
    @Query() query: MenuSummaryRangeQueryDto,
    @Req() req: AuthRequest,
  ): Promise<MenuItemSummary[]> {
    return this.menuService.getSummaryRange(query.dateFrom, query.dateTo, req.user);
  }

  /** Form-generation status: when it was generated and which version. */
  @Get('form')
  async formStatus(): Promise<FormStatus> {
    const roi = await this.thresholdConfig.getRoi();
    const [templates, catalog] = await Promise.all([
      this.templatesService.getActiveTemplates(),
      this.menuService.activeCatalogSnapshot(),
    ]);
    const active = new Map(templates.map((template) => [template.mode, template]));
    const status = (mode: OmrFormMode, orientation: OmrFormOrientation, capacity: number | null) => {
      const template = active.get(mode);
      const capacityExceeded = capacity !== null && catalog.length > capacity;
      const catalogEmpty = mode === OmrFormMode.FULL_LIST && catalog.length === 0;
      return {
        mode,
        generatedAt: template?.activatedAt ?? null,
        version: template?.revision ?? null,
        orientation,
        available: !capacityExceeded && !catalogEmpty,
        unavailableReason: capacityExceeded
          ? 'FORM_TEMPLATE.CAPACITY_EXCEEDED'
          : catalogEmpty ? 'FORM_TEMPLATE.CATALOG_EMPTY' : null,
        activeItemCount: catalog.length,
        capacity,
      };
    };
    const activeCode = active.get(OmrFormMode.CODE);
    return {
      generatedAt: activeCode?.activatedAt ?? roi.roiGeneratedAt,
      version: activeCode?.revision ?? roi.roiVersion,
      templates: {
        [OmrFormMode.CODE]: status(OmrFormMode.CODE, OmrFormOrientation.PORTRAIT, null),
        [OmrFormMode.FULL_LIST]: status(OmrFormMode.FULL_LIST, OmrFormOrientation.LANDSCAPE, 52),
      },
    };
  }

  /** Admin-only: a non-admin able to mutate the menu could trigger a position remap. */
  @Post()
  @Roles(OperatorRole.ADMIN)
  addItem(@Body() dto: CreateMenuItemDto): Promise<MenuItem> {
    return this.menuService.addItem(dto);
  }

  @Patch(':id')
  @Roles(OperatorRole.ADMIN)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<MenuItem> {
    return this.menuService.updateItem(id, dto);
  }

  @Delete(':id')
  @Roles(OperatorRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.menuService.removeItem(id);
  }

  @Post('reorder')
  @Roles(OperatorRole.ADMIN)
  reorder(@Body() dto: ReorderMenuDto): Promise<MenuItem[]> {
    return this.menuService.reorder(dto.orderedItemIds);
  }

  /**
   * Generates the global OMR scan form PDF from the active menu items and persists the ROI
   * template. The save stamps roiGeneratedAt, which permanently locks reorder/rename/hard-delete
   * so printed checkboxes stay bound to items.
   */
  @Post('form')
  @Roles(OperatorRole.ADMIN)
  async generateForm(@Body('mode') requestedMode?: OmrFormMode): Promise<{ pdfBase64: string }> {
    this.workflowMode.assertOmrFormMutationEnabled();
    await this.menuService.assertCodesFitForm();

    const mode = requestedMode ?? OmrFormMode.CODE;
    if (!Object.values(OmrFormMode).includes(mode)) {
      throw new BadRequestException({ message: 'Unsupported OMR form mode', code: 'OMR_TEMPLATE.MODE_INVALID' });
    }
    const catalog = mode === OmrFormMode.FULL_LIST
      ? await this.menuService.activeCatalogSnapshot()
      : [];
    if (catalog.length > 52) {
      throw new BadRequestException({
        message: 'Full-list templates support at most 52 active items',
        code: 'OMR_TEMPLATE.CAPACITY_EXCEEDED',
      });
    }
    const revision = `a5-${mode}-${new Date().toISOString().replace(/\D/g, '')}`;
    const result = await this.omrClient.generateA5Template({
      mode,
      template_revision: revision,
      catalog_rows: catalog.map((row, rowIndex) => ({
        row_index: rowIndex,
        menu_item_id: row.menuItemId,
        code_snapshot: row.codeSnapshot,
        short_label: row.shortLabelSnapshot,
        price: row.price,
      })),
    });
    const geometry = result.roi_template as Record<string, unknown>;
    const expectedOrientation = mode === OmrFormMode.CODE
      ? OmrFormOrientation.PORTRAIT
      : OmrFormOrientation.LANDSCAPE;
    if (!['omr-a5-v1', 'omr-a5-v2'].includes(String(geometry['schema_version'])) || geometry['mode'] !== mode ||
        geometry['orientation'] !== expectedOrientation) {
      throw new ConflictException({
        message: 'Rendered A5 template contract does not match the requested mode',
        code: 'OMR_TEMPLATE.RENDER_MISMATCH',
      });
    }
    if (mode === OmrFormMode.CODE) {
      await this.templatesService.activateCodeTemplate({ revision, geometry });
    } else {
      await this.templatesService.activateFullListTemplate({
        revision,
        geometry,
        expectedCatalogHash: canonicalCatalogHash(catalog),
      });
    }
    return { pdfBase64: result.pdf_base64 };
  }
}
