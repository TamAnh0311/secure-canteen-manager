import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';

function makeUser(role: OperatorRole): OperatorPublic {
  return {
    id: 'uuid-1',
    username: 'u',
    displayName: 'U',
    role,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeContext(user: OperatorPublic | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no @Roles decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(makeUser(OperatorRole.OPERATOR)))).toBe(true);
  });

  it('allows admin user on admin-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OperatorRole.ADMIN]);
    expect(guard.canActivate(makeContext(makeUser(OperatorRole.ADMIN)))).toBe(true);
  });

  it('throws ForbiddenException when operator role tries to access admin route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OperatorRole.ADMIN]);
    let caught: unknown;
    try {
      guard.canActivate(makeContext(makeUser(OperatorRole.OPERATOR)));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTH.INSUFFICIENT_ROLE' });
  });

  it('throws ForbiddenException when no user on request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([OperatorRole.ADMIN]);
    let caught: unknown;
    try {
      guard.canActivate(makeContext(undefined));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTH.INSUFFICIENT_ROLE' });
  });
});
