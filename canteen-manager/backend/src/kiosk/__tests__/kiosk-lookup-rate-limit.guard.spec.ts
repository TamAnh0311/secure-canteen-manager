import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KioskLookupRateLimitGuard } from '../kiosk-lookup-rate-limit.guard';

function context(ip: string, setHeader = jest.fn()): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: {} }),
      getResponse: () => ({ setHeader }),
    }),
  } as ExecutionContext;
}

describe('KioskLookupRateLimitGuard', () => {
  it('limits each terminal independently and sets no-store on denial', () => {
    const config = { get: jest.fn().mockReturnValue(2) } as unknown as ConfigService;
    const guard = new KioskLookupRateLimitGuard(config as never);
    const headers = jest.fn();

    expect(guard.canActivate(context('10.0.0.1', headers))).toBe(true);
    expect(guard.canActivate(context('10.0.0.1', headers))).toBe(true);
    expect(() => guard.canActivate(context('10.0.0.1', headers))).toThrow(HttpException);
    expect(guard.canActivate(context('10.0.0.2'))).toBe(true);
    expect(headers).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
  });
});
