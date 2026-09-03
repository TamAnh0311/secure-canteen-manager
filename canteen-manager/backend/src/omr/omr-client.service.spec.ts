import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from '../config/env-validation';
import { OmrClientService, OmrPermanentError } from './omr-client.service';

describe('OmrClientService error redaction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drains but never logs a rejected sidecar body that may contain token or image details', async () => {
    const leakedToken = '123e4567-e89b-42d3-a456-426614174000';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ detail: `malformed QR ${leakedToken}` }),
      { status: 422 },
    ));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const config = {
      get: jest.fn((key: keyof AppEnv) => key === 'OMR_SERVICE_URL' ? 'http://omr.invalid' : 1000),
    };
    const service = new OmrClientService(config as unknown as ConfigService<AppEnv, true>);

    await expect(service.processScan({
      image_base64: 'c3ludGhldGlj',
      roi_template: {},
      omr_thresholds: { empty_max: 0.3, ticked_min: 0.7 },
      icr_threshold: 0.85,
      digit_box_count: 0,
    })).rejects.toBeInstanceOf(OmrPermanentError);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('/process-scan returned 422');
    expect(logged).not.toContain(leakedToken);
    expect(logged).not.toContain('malformed QR');
  });
});

describe('OmrClientService A5 transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function service(): OmrClientService {
    const config = {
      get: jest.fn((key: keyof AppEnv) => key === 'OMR_SERVICE_URL' ? 'http://omr.invalid' : 1000),
    };
    return new OmrClientService(config as unknown as ConfigService<AppEnv, true>);
  }

  it('uses the versioned A5 template endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      roi_template: { schema_version: 'omr-a5-v1', mode: 'code' },
      pdf_base64: 'JVBERg==',
    }), { status: 200 }));

    await service().generateA5Template({
      mode: 'code',
      template_revision: 'a5-code-r1',
      catalog_rows: [],
    });

    expect(fetchMock).toHaveBeenCalledWith('http://omr.invalid/generate-a5-template', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        mode: 'code',
        template_revision: 'a5-code-r1',
        catalog_rows: [],
      }),
    }));
  });

  it('keeps full bearer tokens out of the returned batch manifest', async () => {
    const token = '123e4567-e89b-42d3-a456-426614174000';
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      roi_template: { schema_version: 'omr-a5-v1', mode: 'code' },
      pdf_base64: 'JVBERg==',
      page_count: 1,
      manifest: [{ page_number: 1, short_serial: '123E4567', prison_id: 'P-1' }],
    }), { status: 200 }));

    const result = await service().renderIssuedBatch({
      mode: 'code',
      template_revision: 'a5-code-r1',
      catalog_rows: [],
      pages: [{ personalization: {
        form_token: token,
        short_serial: '123E4567',
        service_date: '2026-07-18',
        name: 'Nguyen Van An',
        prison_id: 'P-1',
        zone: 'Khu A',
        cell: 'A-12',
      } }],
    });

    expect(JSON.stringify(result.manifest)).not.toContain(token);
    expect(result.page_count).toBe(1);
  });
});
