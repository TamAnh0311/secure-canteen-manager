import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { UsersService } from '../users.service';
import { User } from '../user.entity';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { OperatorZoneAccessService } from '../../auth/operator-zone-access.service';
import { CELL_NORMALIZATION_VERSION } from '../cell-normalization';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    legacyId: 'U001',
    name: 'Inmate One',
    zone: null,
    cell: null,
    isActive: true,
    source: 'sql2005',
    syncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

function buildService(user: User | null) {
  const repo = {
    findOne: jest.fn(async () => user),
  } as unknown as Repository<User>;
  return new UsersService(repo);
}

// Chainable query-builder stub whose getRawAndEntities() yields a fixed result, so the
// balance-join mapping in list()/search() can be asserted without a live DB.
function buildQbStub(result: { entities: User[]; raw: Array<{ balance: string | number }> }) {
  const qb: Record<string, jest.Mock> = {};
  Object.assign(qb, {
    leftJoin: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    take: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getRawAndEntities: jest.fn(async () => result),
  });
  return qb;
}

function buildServiceWithQb(qb: ReturnType<typeof buildQbStub>) {
  const repo = {
    createQueryBuilder: jest.fn(() => qb),
  } as unknown as Repository<User>;
  return new UsersService(repo);
}

describe('UsersService.assertActive()', () => {
  it('returns the user when active', async () => {
    const user = makeUser({ isActive: true });
    const svc = buildService(user);
    await expect(svc.assertActive(user.id)).resolves.toBe(user);
  });

  it('throws USER.INACTIVE for a deactivated (released/transferred) prisoner', async () => {
    const svc = buildService(makeUser({ isActive: false }));
    await expect(svc.assertActive('user-uuid-1')).rejects.toMatchObject({
      response: { code: 'USER.INACTIVE' },
    });
    await expect(svc.assertActive('user-uuid-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws USER.NOT_FOUND when the user does not exist', async () => {
    const svc = buildService(null);
    await expect(svc.assertActive('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.scannerIdentityReadiness()', () => {
  function readinessService(raw: { activeUsers: string; invalidLegacyIds: string }) {
    const qb: Record<string, jest.Mock> = {};
    Object.assign(qb, {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      getRawOne: jest.fn(async () => raw),
    });
    return {
      service: new UsersService({
        createQueryBuilder: jest.fn(() => qb),
        manager: { connection: { options: { type: 'postgres' } } },
      } as unknown as Repository<User>),
      qb,
    };
  }

  it('reports invalid active legacy IDs as a production preflight blocker', async () => {
    const { service, qb } = readinessService({ activeUsers: '4', invalidLegacyIds: '2' });
    await expect(service.scannerIdentityReadiness()).resolves.toEqual({
      activeUsers: 4,
      invalidLegacyIds: 2,
      ready: false,
    });
    expect(qb.where).toHaveBeenCalledWith('u.is_active = true');
  });

  it('reports a clean six-digit active roster as ready', async () => {
    await expect(readinessService({ activeUsers: '4', invalidLegacyIds: '0' }).service.scannerIdentityReadiness())
      .resolves.toEqual({ activeUsers: 4, invalidLegacyIds: 0, ready: true });
  });
});

describe('UsersService directory balance join', () => {
  it('list() maps the COALESCE balance (bigint string) onto each user', async () => {
    const user = makeUser();
    const qb = buildQbStub({ entities: [user], raw: [{ balance: '150000' }] });
    const svc = buildServiceWithQb(qb);

    const [row] = await svc.list({ limit: 50, offset: 0 });

    expect(row.id).toBe(user.id);
    expect(row.balance).toBe(150000); // string → number, not "150000"
    expect(qb.leftJoin).toHaveBeenCalledWith('prisoner_accounts', 'pa', 'pa.user_id = u.id');
    expect(qb.take).toHaveBeenCalledWith(50);
    expect(qb.skip).toHaveBeenCalledWith(0);
  });

  it('search() applies q + department filters and still returns balance', async () => {
    const user = makeUser();
    const qb = buildQbStub({ entities: [user], raw: [{ balance: 0 }] });
    const svc = buildServiceWithQb(qb);

    const rows = await svc.search({ q: 'inmate', zone: 'A1', limit: 50, offset: 0 });

    expect(rows[0].balance).toBe(0); // COALESCE 0 when no account row exists
    expect(qb.andWhere).toHaveBeenCalledTimes(2); // one for q, one for zone
  });

  it('search() filters on the zone column (renamed from department)', async () => {
    const qb = buildQbStub({ entities: [makeUser()], raw: [{ balance: 0 }] });
    const svc = buildServiceWithQb(qb);

    await svc.search({ zone: 'Khu A', limit: 50, offset: 0 });

    // The filter must target u.zone, not the dropped u.department column.
    expect(qb.andWhere).toHaveBeenCalledWith(
      'LOWER(u.zone) LIKE LOWER(:zone)',
      { zone: '%Khu A%' },
    );
  });
});

describe('UsersService issuance roster authority', () => {
  const actor = {
    id: '22222222-2222-4222-8222-222222222222',
    role: OperatorRole.OPERATOR,
    zone: 'Khu A',
  } as OperatorPublic;

  function rosterHarness(users: User[] = []) {
    const qb: Record<string, jest.Mock> = {};
    Object.assign(qb, {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      distinct: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      getMany: jest.fn(async () => users),
      getRawMany: jest.fn(async () => []),
    });
    const repo = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<User>;
    const zoneAccess = {
      scopeByUser: jest.fn((builder) => builder),
    };
    return {
      service: new UsersService(repo, zoneAccess as unknown as OperatorZoneAccessService),
      qb,
      zoneAccess,
    };
  }

  it('uses active exact zone/cell predicates, operator scope, and stable zone/cell/name/legacy/id ordering', async () => {
    const rows = [
      makeUser({ id: 'b', legacyId: 'P002', name: 'Binh', zone: ' Khu A ', cell: ' A-12 ' }),
      makeUser({ id: 'a', legacyId: 'P001', name: 'An', zone: ' Khu A ', cell: ' A-12 ' }),
    ];
    const h = rosterHarness(rows);

    await expect(h.service.listIssuanceRoster(actor, '  Khu A ', ' A-12 ')).resolves.toEqual([
      { id: 'b', legacyId: 'P002', name: 'Binh', zone: 'Khu A', cell: 'A-12' },
      { id: 'a', legacyId: 'P001', name: 'An', zone: 'Khu A', cell: 'A-12' },
    ]);

    expect(h.qb.where).toHaveBeenCalledWith('u.is_active = true');
    expect(h.qb.andWhere).toHaveBeenCalledWith(
      'TRIM(u.zone) = :rosterZone',
      { rosterZone: 'Khu A' },
    );
    expect(h.qb.andWhere).toHaveBeenCalledWith(
      "NULLIF(TRIM(u.cell), '') = :rosterCell",
      { rosterCell: 'A-12' },
    );
    expect(h.qb.orderBy).toHaveBeenCalledWith('TRIM(u.zone)', 'ASC');
    expect(h.qb.addOrderBy.mock.calls).toEqual([
      ["NULLIF(TRIM(u.cell), '')", 'ASC', 'NULLS FIRST'],
      ['u.name', 'ASC'],
      ['u.legacyId', 'ASC'],
      ['u.id', 'ASC'],
    ]);
    expect(h.zoneAccess.scopeByUser).toHaveBeenCalledWith(
      h.qb,
      actor,
      'u.zone',
      'rosterActorZone',
    );
  });

  it('treats omitted cell as the explicit null/blank-cell roster and preserves null in output', async () => {
    const h = rosterHarness([
      makeUser({ zone: 'Khu A', cell: '   ' }),
      makeUser({ id: 'user-uuid-2', legacyId: 'U002', zone: 'Khu A', cell: null }),
    ]);

    const result = await h.service.listIssuanceRoster(actor, 'Khu A', null);

    expect(h.qb.andWhere).toHaveBeenCalledWith("NULLIF(TRIM(u.cell), '') IS NULL");
    expect(result.map((row) => row.cell)).toEqual([null, null]);
  });

  it('returns only scoped active zone/cell options and keeps null cells explicit', async () => {
    const h = rosterHarness();
    h.qb.getRawMany.mockResolvedValue([
      { zone: 'Khu A', cell: null },
      { zone: 'Khu A', cell: 'A-12' },
      { zone: 'Khu B', cell: 'B-01' },
    ]);

    await expect(h.service.listIssuanceRosterOptions(actor)).resolves.toEqual({
      zones: [
        { zone: 'Khu A', cells: [null, 'A-12'] },
        { zone: 'Khu B', cells: ['B-01'] },
      ],
    });
    expect(h.qb.where).toHaveBeenCalledWith('u.is_active = true');
    expect(h.qb.addOrderBy).toHaveBeenCalledWith('cell', 'ASC', 'NULLS FIRST');
    expect(h.zoneAccess.scopeByUser).toHaveBeenCalledWith(h.qb, actor, 'u.zone');
  });

  it('rejects a mixed current zone/cell selection before issuance authority is returned', async () => {
    const h = rosterHarness([
      makeUser({ id: 'a', zone: 'Khu A', cell: 'A-12' }),
      makeUser({ id: 'b', zone: 'Khu A', cell: 'A-13' }),
    ]);

    await expect(h.service.loadIssuanceSelection(actor, ['b', 'a'])).rejects.toMatchObject({
      response: { code: 'OMR_FORM.ROSTER_MISMATCH' },
    });
    expect(h.qb.orderBy).toHaveBeenCalledWith('u.id', 'ASC');
    expect(h.zoneAccess.scopeByUser).toHaveBeenCalledWith(
      h.qb,
      actor,
      'u.zone',
      'selectionActorZone',
    );
  });
});

describe('UsersService generic normalized-cell authority', () => {
  const actor = {
    id: 'operator-1',
    role: OperatorRole.OPERATOR,
    zone: 'Khu A',
  } as OperatorPublic;

  it('uses the shared versioned normalized value in the actor-scoped exact lookup', async () => {
    const qb: Record<string, jest.Mock> = {};
    Object.assign(qb, {
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      getMany: jest.fn(async () => [makeUser({ cell: ' A-01 ' })]),
    });
    const repo = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<User>;
    const zoneAccess = { scopeByUser: jest.fn((builder) => builder) };
    const service = new UsersService(repo, zoneAccess as unknown as OperatorZoneAccessService);

    await expect(service.findActiveByExactCell(' a 01 ', actor)).resolves.toHaveLength(1);

    expect(qb.andWhere).toHaveBeenCalledWith(
      'u.normalized_cell = :normalizedCell',
      { normalizedCell: 'A01' },
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      'u.cell_normalization_version = :normalizationVersion',
      { normalizationVersion: CELL_NORMALIZATION_VERSION },
    );
    expect(zoneAccess.scopeByUser).toHaveBeenCalledWith(qb, actor, 'u.zone', 'cellActorZone');
  });

  it('maps the aggregate SQL audit and fails closed on blanks, stale rows, or collisions', async () => {
    const query = jest.fn().mockResolvedValue([{
      active_users: '8',
      blank: '1',
      stale_version: '2',
      collision_groups: '1',
      users_in_collisions: '2',
    }]);
    const service = new UsersService({
      query,
      manager: { connection: { options: { type: 'postgres' } } },
    } as unknown as Repository<User>);

    await expect(service.assertGenericCellIdentityReady()).rejects.toMatchObject({
      response: {
        code: 'OMR_GENERIC.CELL_AUDIT_FAILED',
        audit: {
          activeUsers: 8,
          blank: 1,
          staleVersion: 2,
          collisionGroups: 1,
          usersInCollisions: 2,
          version: CELL_NORMALIZATION_VERSION,
        },
      },
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('HAVING count(*) > 1'), [
      CELL_NORMALIZATION_VERSION,
    ]);
  });

  it('accepts a fully fresh and unique active normalized-cell population', async () => {
    const query = jest.fn().mockResolvedValue([{
      active_users: 8,
      blank: 0,
      stale_version: 0,
      collision_groups: 0,
      users_in_collisions: 0,
    }]);
    const service = new UsersService({
      query,
      manager: { connection: { options: { type: 'postgres' } } },
    } as unknown as Repository<User>);

    await expect(service.assertGenericCellIdentityReady()).resolves.toMatchObject({
      activeUsers: 8,
      version: CELL_NORMALIZATION_VERSION,
    });
  });
});
