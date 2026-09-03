import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { RolesGuard } from '../../auth/roles.guard';
import { AppEnv } from '../../config/env-validation';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { ScanAuthGuard } from '../scan-auth.guard';
import { ScansController } from '../scans.controller';
import { ScansService } from '../scans.service';
import { DemoScanService } from '../demo-scan.service';
import { SheetStatus } from '../sheet-status.enum';
import { Sheet } from '../sheet.entity';

const FORM_TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const AGENT_TOKEN = 'scanner-agent-token-long-enough';

function operator(role: OperatorRole): Operator {
  return {
    id: `${role}-id`,
    username: role,
    displayName: role,
    role,
    isActive: true,
    passwordHash: 'not-public',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Operator;
}

function roleContext(
  controller: ScansController,
  method: keyof ScansController,
  role: OperatorRole,
): ExecutionContext {
  return {
    getHandler: () => controller[method],
    getClass: () => ScansController,
    switchToHttp: () => ({ getRequest: () => ({ user: operator(role) }) }),
  } as unknown as ExecutionContext;
}

function authContext(headers: Record<string, string>): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; user?: unknown };
} {
  const request = { headers } as { headers: Record<string, string>; user?: unknown };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function sensitiveSheet(): Sheet {
  return {
    id: 'sheet-id',
    sheetId: 'FORM-001',
    batch: null,
    serviceDate: '2026-07-15',
    checksum: 'a'.repeat(64),
    imagePath: '/private/scans/secret.png',
    status: SheetStatus.FLAGGED,
    resultJson: {
      form_token: FORM_TOKEN,
      order_lines: [],
    },
    avgConfidence: 0.97,
    recognizedId: 'P-004218',
    matchedUserId: 'user-id',
    matchedUser: null,
    orderId: null,
    flags: null,
    issuedFormId: FORM_TOKEN,
    createdAt: new Date('2026-07-14T10:00:00.000Z'),
    updatedAt: new Date('2026-07-14T10:01:00.000Z'),
    processedAt: new Date('2026-07-14T10:01:00.000Z'),
  } as Sheet;
}

describe('ScansController authorization', () => {
  const scansService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    getKpi: jest.fn(),
    submit: jest.fn(),
  };
  const controller = new ScansController(
    scansService as unknown as ScansService,
    { createDemoRecord: jest.fn() } as unknown as DemoScanService,
  );
  const rolesGuard = new RolesGuard(new Reflector());

  it.each(['generateDemo', 'kpi', 'findAll', 'findOne'] as const)(
    'allows OPERATOR and ADMIN but denies CASHIER on %s',
    (method) => {
      expect(rolesGuard.canActivate(roleContext(controller, method, OperatorRole.OPERATOR))).toBe(true);
      expect(rolesGuard.canActivate(roleContext(controller, method, OperatorRole.ADMIN))).toBe(true);
      expect(() =>
        rolesGuard.canActivate(roleContext(controller, method, OperatorRole.CASHIER)),
      ).toThrow(ForbiddenException);
    },
  );
});

describe('ScansController response redaction', () => {
  it.each(['findAll', 'findOne'] as const)(
    'does not expose raw result, private path, checksum, handwritten identity, or bearer token from %s',
    async (method) => {
      const sheet = sensitiveSheet();
      const scansService = {
        findAll: jest.fn().mockResolvedValue([sheet]),
        findOne: jest.fn().mockResolvedValue(sheet),
      };
      const controller = new ScansController(
        scansService as unknown as ScansService,
        {} as DemoScanService,
      );

      const result = method === 'findAll'
        ? await controller.findAll({ limit: 50, offset: 0 }, { user: operator(OperatorRole.OPERATOR) } as never)
        : await controller.findOne(sheet.id, { user: operator(OperatorRole.OPERATOR) } as never);
      const rows = Array.isArray(result) ? result : [result];
      const publicSheet = rows[0] as unknown as Record<string, unknown>;
      const serialized = JSON.stringify(result);

      expect(publicSheet).toMatchObject({ id: sheet.id, sheetId: sheet.sheetId, status: sheet.status });
      expect(publicSheet).not.toHaveProperty('resultJson');
      expect(publicSheet).not.toHaveProperty('imagePath');
      expect(publicSheet).not.toHaveProperty('checksum');
      expect(publicSheet).not.toHaveProperty('recognizedId');
      expect(publicSheet).not.toHaveProperty('issuedFormId');
      expect(serialized).not.toContain(FORM_TOKEN);
      expect(serialized).not.toContain('/private/scans');
      expect(serialized).not.toContain('form_token');
    },
  );
});

describe('ScansController demo generation', () => {
  it('passes the authenticated operator id to demo form issuance', async () => {
    const demoSheet = sensitiveSheet();
    const demoScanService = {
      createDemoRecord: jest.fn().mockResolvedValue(demoSheet),
    };
    const controller = new ScansController(
      {} as ScansService,
      demoScanService as unknown as DemoScanService,
    );

    const result = await controller.generateDemo(
      {},
      { user: operator(OperatorRole.OPERATOR) } as never,
    );

    expect(demoScanService.createDemoRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'operator-id', role: OperatorRole.OPERATOR }),
    );
    expect(result).toEqual({
      id: demoSheet.id,
      sheetId: demoSheet.sheetId,
      status: demoSheet.status,
    });
  });
});

describe('ScanAuthGuard upload role boundary', () => {
  const config = { get: jest.fn().mockReturnValue(AGENT_TOKEN) };
  const jwt = { verifyAsync: jest.fn() };
  const operators = { findOne: jest.fn() };
  const guard = new ScanAuthGuard(
    config as unknown as ConfigService<AppEnv, true>,
    jwt as unknown as JwtService,
    operators as unknown as Repository<Operator>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(AGENT_TOKEN);
  });

  it('retains the hardware-agent credential as an upload-only authentication path', async () => {
    const { context } = authContext({ 'x-agent-token': AGENT_TOKEN });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it.each([OperatorRole.OPERATOR, OperatorRole.ADMIN])('allows an active %s JWT to upload', async (role) => {
    jwt.verifyAsync.mockResolvedValue({ sub: `${role}-id` });
    operators.findOne.mockResolvedValue(operator(role));
    const { context } = authContext({ authorization: 'Bearer valid.jwt' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('returns 403 for an authenticated CASHIER JWT instead of treating it as an agent', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'cashier-id' });
    operators.findOne.mockResolvedValue(operator(OperatorRole.CASHIER));
    const { context } = authContext({ authorization: 'Bearer valid.jwt' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still returns 401 for missing credentials', async () => {
    const { context } = authContext({});
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
