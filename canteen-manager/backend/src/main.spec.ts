import { ConfigService } from '@nestjs/config';
import { configureRequestBodyParsers } from './main';

describe('HTTP body parser ordering', () => {
  it('installs the exact-byte scanner parser before the existing 15 MiB JSON parser', () => {
    const app = {
      use: jest.fn(),
      useBodyParser: jest.fn(),
    };
    const config = {
      get: jest.fn().mockReturnValue(512 * 1024),
    } as unknown as ConfigService<any, true>;

    configureRequestBodyParsers(app as never, config);

    expect(app.use).toHaveBeenCalledTimes(1);
    expect(app.use.mock.calls[0][0]).toBe('/webhooks/order-scanner');
    expect(app.useBodyParser).toHaveBeenCalledWith('json', { limit: '15mb' });
    expect(app.use.mock.invocationCallOrder[0]).toBeLessThan(app.useBodyParser.mock.invocationCallOrder[0]);
  });
});
