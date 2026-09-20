import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env-validation';
import { LocalFormRendererService } from './local-form-renderer';

export interface GenerateFormInput {
  // The menu is global — the form is no longer tied to a session, so no session_id is sent.
  menu_items: Array<{ position: number; name: string }>;
  digit_box_count: number;
  paper_size: string;
  sheet_id_mode: string;
  personalization?: {
    form_token: string;
    short_serial: string;
    service_date: string;
    name: string;
    prison_id: string;
    zone: string | null;
    cell: string | null;
  };
}

export interface GenerateFormResult {
  // Opaque blob — stored as-is on the global threshold_config row and forwarded verbatim to
  // /process-scan. Backend must not parse or depend on its internal structure.
  roi_template: object;
  pdf_base64: string;
}

export type OmrFormMode = 'code' | 'full_list';

export interface CatalogRowInput {
  row_index: number;
  menu_item_id: string;
  code_snapshot: string;
  short_label: string;
  /** Integer VND price. Optional — only used by the local full-list renderer. */
  price?: number;
}

export interface GenerateA5TemplateInput {
  mode: OmrFormMode;
  template_revision: string;
  catalog_rows: CatalogRowInput[];
}

export interface RenderBatchPageInput {
  personalization: NonNullable<GenerateFormInput['personalization']>;
}

export interface RenderIssuedBatchInput extends GenerateA5TemplateInput {
  pages: RenderBatchPageInput[];
}

export interface RenderIssuedBatchResult extends GenerateFormResult {
  page_count: number;
  manifest: Array<{
    page_number: number;
    short_serial: string;
    prison_id: string;
  }>;
}

export interface RenderGenericMasterInput extends GenerateA5TemplateInput {
  template_id: string;
}

export interface RenderGenericMasterResult extends GenerateFormResult {
  page_count: 1;
  form_reference: string;
}

export interface ProcessScanInput {
  image_base64: string;
  roi_template: object;
  omr_thresholds: { empty_max: number; ticked_min: number };
  icr_threshold: number;
  digit_box_count: number;
  expected_form_token?: string;
  expected_form_reference?: string;
}

export interface IdentifyFormTokenResult {
  form_token: string | null;
  form_reference?: string | null;
  flags: string[];
}

export interface HandwritingFieldResult {
  field: 'name' | 'cell' | 'prisoner_id';
  status: 'recognized' | 'blank' | 'abstained' | 'error';
  raw_text: string | null;
  confidence: number | null;
  raw_score: number | null;
  flags: string[];
}

export interface RecognitionModelEvidence {
  adapter: string;
  model_name: string;
  model_version: string;
  weights_sha256: string;
  runtime: string;
  execution_provider: string;
  preprocessing_version: string;
  calibration_version: string | null;
}

export interface DigitResult {
  index: number;
  value: number | null;
  confidence: number;
}

// Per-line recognition result from the code+qty order-line reader in omr-service.
// code/qty are null when any digit in that group read below the ICR confidence threshold.
export interface OrderLineResult {
  line_index: number;
  code: string | null;
  qty: number | null;
  code_digits: DigitResult[];
  qty_digits: DigitResult[];
  flags: string[];
  menu_item_id?: string;
  code_snapshot?: string;
  name_snapshot?: string;
}

// ROI descriptor for one order-line row (code digit boxes + qty digit boxes).
export interface DigitBoxRoi {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OrderLineRoi {
  line_index: number;
  code_boxes: DigitBoxRoi[];
  qty_boxes: DigitBoxRoi[];
}

export interface ProcessScanResult {
  form_token: string | null;
  form_reference?: string | null;
  recognized_id: string | null;
  id_digits: DigitResult[];
  order_lines: OrderLineResult[];
  avg_confidence: number;
  flags: string[];
  warp_ok: boolean;
  handwriting_fields?: HandwritingFieldResult[];
  handwriting_model?: RecognitionModelEvidence | null;
}

export class OmrPermanentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OmrPermanentError';
  }
}

export class OmrRetryableError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OmrRetryableError';
  }
}

export interface WarpSheetInput {
  image_base64: string;
  roi_template: object;
}

export interface WarpSheetResult {
  warped_image_base64: string;
  template_width_px: number;
  template_height_px: number;
  warp_ok: boolean;
}

@Injectable()
export class OmrClientService {
  private readonly logger = new Logger(OmrClientService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly localRenderer: LocalFormRendererService,
  ) {
    this.baseUrl = this.config.get('OMR_SERVICE_URL', { infer: true });
    this.timeoutMs = this.config.get('OMR_SERVICE_TIMEOUT_MS', { infer: true });
  }

  /** Uses local renderer when OMR_SERVICE_URL is empty or 'local'. */
  private get useLocal(): boolean {
    return !this.baseUrl || this.baseUrl === 'local';
  }

  async generateForm(input: GenerateFormInput): Promise<GenerateFormResult> {
    return this.post<GenerateFormResult>('/generate-form', input);
  }

  async generateA5Template(input: GenerateA5TemplateInput): Promise<GenerateFormResult> {
    if (this.useLocal) {
      return this.localRenderer.renderTemplate(input);
    }
    try {
      return await this.post<GenerateFormResult>('/generate-a5-template', input);
    } catch (err) {
      if (err instanceof OmrRetryableError) {
        this.logger.warn('External OMR service unavailable, falling back to local renderer');
        return this.localRenderer.renderTemplate(input);
      }
      throw err;
    }
  }

  async renderIssuedBatch(input: RenderIssuedBatchInput): Promise<RenderIssuedBatchResult> {
    return this.post<RenderIssuedBatchResult>('/render-issued-batch', input);
  }

  async renderGenericMaster(input: RenderGenericMasterInput): Promise<RenderGenericMasterResult> {
    return this.post<RenderGenericMasterResult>('/render-generic-master', input);
  }

  async processScan(input: ProcessScanInput): Promise<ProcessScanResult> {
    return this.post<ProcessScanResult>('/process-scan', input);
  }

  async identifyFormToken(imageBase64: string): Promise<IdentifyFormTokenResult> {
    return this.post<IdentifyFormTokenResult>('/identify-form-token', { image_base64: imageBase64 });
  }

  async preflightImage(imageBase64: string): Promise<{ width: number; height: number }> {
    return this.post<{ width: number; height: number }>('/preflight-image', { image_base64: imageBase64 });
  }

  async warpSheet(input: WarpSheetInput): Promise<WarpSheetResult> {
    return this.post<WarpSheetResult>('/warp-sheet', input);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OMR service request failed [${path}]: ${message}`);
      throw new OmrRetryableError('OMR.SERVICE_UNAVAILABLE', `OMR service unreachable: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // The sidecar's validation body can echo malformed QR/token or image details.
      // Keep operational logs to the route and status; callers receive a stable,
      // redacted error code below.
      await response.text().catch(() => '');
      this.logger.warn(`OMR service ${path} returned ${response.status}`);
      if (response.status >= 400 && response.status < 500) {
        throw new OmrPermanentError('OMR.INVALID_IMAGE', `OMR service rejected input (${response.status})`);
      }
      throw new OmrRetryableError('OMR.SERVICE_ERROR', `OMR service error ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
