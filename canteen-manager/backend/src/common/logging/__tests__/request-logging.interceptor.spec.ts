import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { RequestLoggingInterceptor } from '../request-logging.interceptor';

describe('RequestLoggingInterceptor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts every private upload field while retaining useful request context', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new RequestLoggingInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/scans',
          body: {
            sheetId: 'FORM-PRIVATE-001',
            batch: 'PRIVATE-BATCH',
            checksum: 'a'.repeat(64),
            imageBase64: 'PRIVATE-IMAGE',
            clientVersion: 'scanner-1.2.3',
          },
        }),
      }),
    } as ExecutionContext;
    const next = { handle: jest.fn(() => of(undefined)) } as CallHandler;

    await firstValueFrom(interceptor.intercept(context, next));

    const requestLog = String(log.mock.calls[0]?.[0]);
    expect(requestLog).toContain('--> POST /scans');
    expect(requestLog).toContain('"clientVersion":"scanner-1.2.3"');
    expect(requestLog).toContain('"sheetId":"[REDACTED]"');
    expect(requestLog).toContain('"batch":"[REDACTED]"');
    expect(requestLog).toContain('"checksum":"[REDACTED]"');
    expect(requestLog).toContain('"imageBase64":"[REDACTED]"');
    expect(requestLog).not.toContain('FORM-PRIVATE-001');
    expect(requestLog).not.toContain('PRIVATE-BATCH');
    expect(requestLog).not.toContain('a'.repeat(64));
    expect(requestLog).not.toContain('PRIVATE-IMAGE');
    expect(log.mock.calls[1]?.[0]).toMatch(/^<-- POST \/scans \d+ms$/);
  });

  it('redacts plain and encoded kiosk prisoner identifiers from all request logs', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new RequestLoggingInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          url: '/kiosk/prisoner/P%2FPRIVATE?lang=vi',
          body: undefined,
        }),
      }),
    } as ExecutionContext;
    const next = { handle: jest.fn(() => of(undefined)) } as CallHandler;

    await firstValueFrom(interceptor.intercept(context, next));

    expect(log.mock.calls.flat().join(' ')).toContain('/kiosk/prisoner/[REDACTED]?lang=vi');
    expect(log.mock.calls.flat().join(' ')).not.toContain('P%2FPRIVATE');
  });

  it('does not serialize raw webhook bytes into request logs', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const interceptor = new RequestLoggingInterceptor();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/webhooks/order-scanner', body: Buffer.from('secret-payload') }),
      }),
    } as ExecutionContext;
    const next = { handle: jest.fn(() => of(undefined)) } as CallHandler;

    await firstValueFrom(interceptor.intercept(context, next));

    const requestLog = String(log.mock.calls[0]?.[0]);
    expect(requestLog).toContain('[REDACTED_RAW_BODY]');
    expect(requestLog).not.toContain('secret-payload');
    expect(requestLog).not.toContain('115,101,99,114,101,116');
  });
});
