import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { OperatorZoneAccessService } from '../operator-zone-access.service';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { User } from '../../users/user.entity';

function actor(role: OperatorRole, zone?: string | null): OperatorPublic {
  return { id: 'actor-1', role, zone } as OperatorPublic;
}

describe('OperatorZoneAccessService', () => {
  const service = new OperatorZoneAccessService({} as Repository<User>);

  it('returns a normalized assigned zone for OPERATOR', () => {
    expect(service.requireOperatorZone(actor(OperatorRole.OPERATOR, '  Khu A1 '))).toBe('Khu A1');
  });

  it.each([null, undefined, '', '   '])('fails closed for an OPERATOR zone of %p', (zone) => {
    expect(() => service.requireOperatorZone(actor(OperatorRole.OPERATOR, zone)))
      .toThrow(ForbiddenException);
  });

  it.each([OperatorRole.ADMIN, OperatorRole.CASHIER])(
    'does not apply OPERATOR assignment semantics to %s',
    (role) => {
      expect(service.requireOperatorZone(actor(role, null))).toBeNull();
    },
  );

  it('adds a parameterized exact trimmed predicate', () => {
    const qb = { andWhere: jest.fn().mockReturnThis() };
    service.scopeByUser(qb as never, actor(OperatorRole.OPERATOR, 'Khu A1'), 'u.zone');
    expect(qb.andWhere).toHaveBeenCalledWith(
      'BTRIM(u.zone) = :operatorZone',
      { operatorZone: 'Khu A1' },
    );
  });

  it('scopes a foreign-key resource with EXISTS without adding a pagination join', () => {
    const qb = { andWhere: jest.fn().mockReturnThis() };
    service.scopeByUserId(
      qb as never,
      actor(OperatorRole.OPERATOR, 'Khu A1'),
      'o.user_id',
    );

    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"zone_scope_user"."id" = o.user_id'),
      { operatorZone: 'Khu A1' },
    );
    expect(qb.andWhere.mock.calls[0][0]).toContain(
      'BTRIM("zone_scope_user"."zone") = :operatorZone',
    );
  });

  it('locks the authoritative prisoner row when a transaction requests serialization', async () => {
    const user = { id: 'user-1', zone: 'Khu A1' } as User;
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const repo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const manager = { getRepository: jest.fn().mockReturnValue(repo) };
    const lockedService = new OperatorZoneAccessService({} as Repository<User>);

    await lockedService.assertUserAccess(
      actor(OperatorRole.OPERATOR, 'Khu A1'),
      user.id,
      manager as never,
      true,
    );

    expect(qb.setLock).toHaveBeenCalledWith('pessimistic_read');
    expect(qb.setLock.mock.invocationCallOrder[0])
      .toBeLessThan(qb.getOne.mock.invocationCallOrder[0]);
  });
});
