import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { Operator, OperatorRole } from '../../operators/operator.entity';

const BCRYPT_COST = 12;

async function makeOperator(overrides: Partial<Operator> = {}): Promise<Operator> {
  const op = new Operator();
  op.id = 'uuid-001';
  op.username = 'testuser';
  op.passwordHash = await bcrypt.hash('correctpassword', BCRYPT_COST);
  op.displayName = 'Test User';
  op.role = OperatorRole.OPERATOR;
  op.zone = 'Khu A1';
  op.isActive = true;
  op.createdAt = new Date();
  op.updatedAt = new Date();
  return Object.assign(op, overrides);
}

describe('AuthService', () => {
  let authService: AuthService;
  let findOneMock: jest.Mock;

  beforeEach(async () => {
    findOneMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(Operator),
          useValue: { findOne: findOneMock },
        },
        {
          provide: JwtService,
          useValue: { sign: () => 'signed.jwt.token' },
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('returns token + operator profile on valid credentials', async () => {
    const operator = await makeOperator();
    findOneMock.mockResolvedValue(operator);

    const result = await authService.validateAndLogin('testuser', 'correctpassword');

    expect(result.token).toBe('signed.jwt.token');
    expect(result.operator.username).toBe('testuser');
    expect(result.operator.zone).toBe('Khu A1');
    expect(result.operator).not.toHaveProperty('passwordHash');
  });

  it('throws UnauthorizedException on wrong password', async () => {
    const operator = await makeOperator();
    findOneMock.mockResolvedValue(operator);

    await expect(
      authService.validateAndLogin('testuser', 'wrongpassword'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when username does not exist', async () => {
    findOneMock.mockResolvedValue(null);

    await expect(
      authService.validateAndLogin('nobody', 'anypassword'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException for inactive operator even with correct password', async () => {
    const operator = await makeOperator({ isActive: false });
    findOneMock.mockResolvedValue(operator);

    await expect(
      authService.validateAndLogin('testuser', 'correctpassword'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('returns same generic error message for non-existent user and wrong password (no enumeration)', async () => {
    findOneMock.mockResolvedValue(null);
    let notFoundMsg: string | undefined;
    try {
      await authService.validateAndLogin('nobody', 'x');
    } catch (e) {
      notFoundMsg = (e as UnauthorizedException).message;
    }

    const operator = await makeOperator();
    findOneMock.mockResolvedValue(operator);
    let badPassMsg: string | undefined;
    try {
      await authService.validateAndLogin('testuser', 'wrongpassword');
    } catch (e) {
      badPassMsg = (e as UnauthorizedException).message;
    }

    expect(notFoundMsg).toBe(badPassMsg);
  });
});
