import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../auth/roles.guard';
import { OperatorRole } from '../../../operators/operator.entity';
import { VerifyController } from '../verify.controller';
import { VerifyService } from '../verify.service';
import { Response } from 'express';
import { SheetStatus } from '../../sheet-status.enum';
import { Sheet } from '../../sheet.entity';

const FORM_TOKEN = '22222222-2222-4222-8222-222222222222';

function sensitiveSheet(status: SheetStatus): Sheet {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sheetId: 'FORM-001',
    batch: 'private-batch',
    serviceDate: '2026-07-15',
    checksum: 'a'.repeat(64),
    imagePath: '/private/scans/secret.png',
    status,
    resultJson: { form_token: FORM_TOKEN, order_lines: [] },
    issuedFormId: FORM_TOKEN,
    recognizedId: null,
    matchedUserId: '33333333-3333-4333-8333-333333333333',
    orderId: '44444444-4444-4444-8444-444444444444',
    flags: [],
    rejectionCode: null,
    avgConfidence: 0.95,
    createdAt: new Date('2026-07-15T01:00:00.000Z'),
    updatedAt: new Date('2026-07-15T01:01:00.000Z'),
    processedAt: new Date('2026-07-15T01:01:00.000Z'),
  } as unknown as Sheet;
}

function contextFor(
  controller: VerifyController,
  method: keyof VerifyController,
  role: OperatorRole,
): ExecutionContext {
  return {
    getHandler: () => controller[method],
    getClass: () => VerifyController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          id: `${role}-id`,
          username: role,
          displayName: role,
          role,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('VerifyController role gate', () => {
  const controller = new VerifyController({} as VerifyService);
  const guard = new RolesGuard(new Reflector());

  it.each([
    'getQueue',
    'getWarpedImage',
    'confirm',
    'reject',
    'skip',
  ] as const)('allows OPERATOR and ADMIN but returns 403 to CASHIER on %s', (method) => {
    expect(guard.canActivate(contextFor(controller, method, OperatorRole.OPERATOR))).toBe(true);
    expect(guard.canActivate(contextFor(controller, method, OperatorRole.ADMIN))).toBe(true);
    expect(() => guard.canActivate(contextFor(controller, method, OperatorRole.CASHIER))).toThrow(
      ForbiddenException,
    );
  });
});

describe('VerifyController warped image response', () => {
  it('preserves the JPEG content type when the service falls back to a raw JPEG', async () => {
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const verifyService = {
      getWarpedImage: jest.fn().mockResolvedValue({
        imageBytes,
        warpOk: false,
        contentType: 'image/jpeg',
      }),
    };
    const controller = new VerifyController(verifyService as unknown as VerifyService);
    const response = {
      setHeader: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;

    await controller.getWarpedImage(
      '11111111-1111-4111-8111-111111111111',
      { user: { id: 'operator-id' } } as never,
      response,
    );

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(response.setHeader).toHaveBeenCalledWith('X-Warp-Ok', 'false');
    expect(response.end).toHaveBeenCalledWith(imageBytes);
  });
});

describe('VerifyController mutation response redaction', () => {
  it('returns only the replacement outcome after confirm', async () => {
    const sheet = sensitiveSheet(SheetStatus.VERIFIED);
    const verifyService = {
      confirm: jest.fn().mockResolvedValue({
        replaced: true,
        sheet,
        order: {
          id: sheet.orderId,
          userId: sheet.matchedUserId,
          privateAuditField: FORM_TOKEN,
        },
      }),
    };
    const controller = new VerifyController(verifyService as unknown as VerifyService);

    const result = await controller.confirm(
      sheet.id,
      { items: [] },
      { user: { id: 'operator-id' } } as never,
    );

    expect(result).toEqual({ replaced: true });
    expect(JSON.stringify(result)).not.toContain(FORM_TOKEN);
    expect(result).not.toHaveProperty('sheet');
    expect(result).not.toHaveProperty('order');
  });

  it.each([
    ['reject', SheetStatus.REJECTED],
    ['skip', SheetStatus.FLAGGED],
  ] as const)('returns only the public status after %s', async (method, status) => {
    const sheet = sensitiveSheet(status);
    const verifyService = {
      [method]: jest.fn().mockResolvedValue(sheet),
    };
    const controller = new VerifyController(verifyService as unknown as VerifyService);

    const result = await controller[method](
      sheet.id,
      { user: { id: 'operator-id' } } as never,
    );

    expect(result).toEqual({ status });
    expect(JSON.stringify(result)).not.toContain(FORM_TOKEN);
    expect(result).not.toHaveProperty('issuedFormId');
    expect(result).not.toHaveProperty('imagePath');
    expect(result).not.toHaveProperty('resultJson');
  });
});
