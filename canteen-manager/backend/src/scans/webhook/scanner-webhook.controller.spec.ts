import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { ScannerWebhookController } from './scanner-webhook.controller';

describe('ScannerWebhookController', () => {
  const webhook = { ingest: jest.fn().mockResolvedValue({
    eventId: 'evt_test', state: 'received', duplicate: false, quarantined: false,
  }) };
  const controller = new ScannerWebhookController(webhook as never);

  function request(body: unknown, contentType: string | null) {
    return {
      body,
      headers: { 'idempotency-key': 'key' },
      is: jest.fn().mockReturnValue(contentType === 'application/json' ? 'application/json' : false),
    } as never;
  }

  it('rejects unsupported content types before ingestion', async () => {
    await expect(controller.receive(request(Buffer.from('{}'), null))).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(webhook.ingest).not.toHaveBeenCalled();
  });

  it('rejects a missing raw body deliberately', async () => {
    await expect(controller.receive(request({}, 'application/json'))).rejects.toBeInstanceOf(BadRequestException);
    expect(webhook.ingest).not.toHaveBeenCalled();
  });

  it('passes exact raw bytes to the webhook service', async () => {
    const raw = Buffer.from('{"event_id":"evt_test"}');
    await expect(controller.receive(request(raw, 'application/json'))).resolves.toEqual({
      event_id: 'evt_test', state: 'received', duplicate: false, quarantined: false,
    });
    expect(webhook.ingest).toHaveBeenCalledWith(raw, 'key');
  });
});
