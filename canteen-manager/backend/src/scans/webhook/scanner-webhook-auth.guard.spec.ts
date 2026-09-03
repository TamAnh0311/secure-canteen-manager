import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScannerWebhookAuthGuard } from './scanner-webhook-auth.guard';

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('ScannerWebhookAuthGuard', () => {
  const config = {
    get: jest.fn().mockReturnValue('callback-secret-value'),
  } as unknown as ConfigService;

  it('accepts the configured bearer token', () => {
    expect(new ScannerWebhookAuthGuard(config as unknown as ConfigService<any, true>).canActivate(
      context('Bearer callback-secret-value'),
    )).toBe(true);
  });

  it('rejects missing, malformed, and wrong tokens', () => {
    const guard = new ScannerWebhookAuthGuard(config as unknown as ConfigService<any, true>);
    expect(() => guard.canActivate(context())).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context('Basic callback-secret-value'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context('Bearer wrong'))).toThrow(UnauthorizedException);
  });
});
