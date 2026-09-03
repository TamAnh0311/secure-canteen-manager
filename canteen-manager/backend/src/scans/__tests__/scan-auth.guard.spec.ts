import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { ScanAuthGuard } from '../scan-auth.guard';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { AppEnv } from '../../config/env-validation';

const AGENT_TOKEN = 'agent_token_supersecret_value';

function makeContext(headers: Record<string, string>): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string>; user?: unknown };
} {
  const req = { headers } as { headers: Record<string, string>; user?: unknown };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    id: 'op-1',
    username: 'op',
    displayName: 'Op',
    role: OperatorRole.OPERATOR,
    isActive: true,
    passwordHash: 'x',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Operator;
}

describe('ScanAuthGuard', () => {
  let guard: ScanAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let operatorsRepo: { findOne: jest.Mock };

  beforeEach(() => {
    const config = { get: jest.fn().mockReturnValue(AGENT_TOKEN) };
    jwtService = { verifyAsync: jest.fn() };
    operatorsRepo = { findOne: jest.fn() };
    guard = new ScanAuthGuard(
      config as unknown as ConfigService<AppEnv, true>,
      jwtService as unknown as JwtService,
      operatorsRepo as unknown as Repository<Operator>,
    );
  });

  describe('agent-token path', () => {
    it('allows a request whose x-agent-token matches AGENT_TOKEN', async () => {
      const { ctx } = makeContext({ 'x-agent-token': AGENT_TOKEN });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects a wrong token of the SAME length without leaking via timing', async () => {
      const wrong = 'X'.repeat(AGENT_TOKEN.length);
      const { ctx } = makeContext({ 'x-agent-token': wrong });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong token of DIFFERENT length without throwing a length error', async () => {
      // Regression: timingSafeEqual throws on unequal-length buffers; the guard
      // hashes both sides to fixed-width digests first, so a short/long token
      // must resolve to a normal 401 — never a TypeError.
      const { ctx: shortCtx } = makeContext({ 'x-agent-token': 'short' });
      await expect(guard.canActivate(shortCtx)).rejects.toBeInstanceOf(UnauthorizedException);

      const { ctx: longCtx } = makeContext({ 'x-agent-token': AGENT_TOKEN + '_extra_tail' });
      await expect(guard.canActivate(longCtx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an empty token', async () => {
      const { ctx } = makeContext({ 'x-agent-token': '' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('operator-JWT path', () => {
    it('allows a valid JWT for an active operator and sets req.user', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'op-1' });
      operatorsRepo.findOne.mockResolvedValue(makeOperator());
      const { ctx, req } = makeContext({ authorization: 'Bearer good.jwt.token' });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.user).toMatchObject({ id: 'op-1', role: OperatorRole.OPERATOR });
      // public projection must not expose the password hash
      expect(req.user).not.toHaveProperty('passwordHash');
    });

    it('rejects when the operator is inactive', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'op-1' });
      operatorsRepo.findOne.mockResolvedValue(makeOperator({ isActive: false }));
      const { ctx } = makeContext({ authorization: 'Bearer good.jwt.token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the operator no longer exists', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost' });
      operatorsRepo.findOne.mockResolvedValue(null);
      const { ctx } = makeContext({ authorization: 'Bearer good.jwt.token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an invalid/expired JWT', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      const { ctx } = makeContext({ authorization: 'Bearer bad.jwt.token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('rejects a request with no credentials', async () => {
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
