import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Operator, OperatorRole } from '../operator.entity';
import { OperatorsService } from '../operators.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
}));

const mockedHash = bcrypt.hash as jest.MockedFunction<typeof bcrypt.hash>;

function makeOperator(overrides: Partial<Operator> = {}): Operator {
  return {
    id: '56ce134c-d4aa-4296-b035-04cd2fb54013',
    username: 'zone_operator',
    passwordHash: 'stored-password-hash',
    displayName: 'Zone Operator',
    role: OperatorRole.OPERATOR,
    zone: 'Zone A',
    isActive: true,
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    updatedAt: new Date('2026-07-17T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<Repository<Operator>> = {}) {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((data: Partial<Operator>) => makeOperator(data)),
    save: jest.fn(async (operator: Operator) => operator),
    ...overrides,
  } as unknown as Repository<Operator>;
}

function build(overrides: Partial<Repository<Operator>> = {}) {
  const repo = makeRepo(overrides);
  return { service: new OperatorsService(repo), repo };
}

describe('OperatorsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHash.mockResolvedValue('new-password-hash' as never);
  });

  describe('create', () => {
    it('requires and normalizes a zone for an operator', async () => {
      const { service, repo } = build({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const created = await service.create({
        username: 'zone_operator',
        password: 'password123',
        displayName: 'Zone Operator',
        role: OperatorRole.OPERATOR,
        zone: '  Zone A  ',
      });

      expect(repo.create).toHaveBeenCalledWith({
        username: 'zone_operator',
        passwordHash: 'new-password-hash',
        displayName: 'Zone Operator',
        role: OperatorRole.OPERATOR,
        zone: 'Zone A',
      });
      expect(created.zone).toBe('Zone A');
      expect(created).not.toHaveProperty('passwordHash');
    });

    it('rejects a blank operator zone before hashing or saving', async () => {
      const { service, repo } = build({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const error = await service
        .create({
          username: 'unassigned_operator',
          password: 'password123',
          displayName: 'Unassigned Operator',
          role: OperatorRole.OPERATOR,
          zone: '   ',
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'OPERATOR.ZONE_REQUIRED',
      });
      expect(mockedHash).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each([OperatorRole.ADMIN, OperatorRole.CASHIER])(
      'ignores a supplied zone when creating a %s',
      async (role) => {
        const { service, repo } = build({
          findOne: jest.fn().mockResolvedValue(null),
        });

        const created = await service.create({
          username: `${role}_user`,
          password: 'password123',
          displayName: `${role} user`,
          role,
          zone: '  Zone A  ',
        });

        expect(repo.create).toHaveBeenCalledWith(
          expect.objectContaining({ role, zone: null }),
        );
        expect(created.zone).toBeNull();
        expect(created).not.toHaveProperty('passwordHash');
      },
    );
  });

  describe('updateZone', () => {
    it('normalizes assignment and reassignment, then clears the zone', async () => {
      const operator = makeOperator({ zone: null });
      const repo = makeRepo({
        findOne: jest.fn().mockResolvedValue(operator),
      });
      const service = new OperatorsService(repo);

      const assigned = await service.updateZone(operator.id, '  Zone A  ');
      expect(assigned.zone).toBe('Zone A');
      expect(operator.zone).toBe('Zone A');

      const reassigned = await service.updateZone(operator.id, ' Zone B ');
      expect(reassigned.zone).toBe('Zone B');
      expect(operator.zone).toBe('Zone B');

      const cleared = await service.updateZone(operator.id, '   ');
      expect(cleared.zone).toBeNull();
      expect(operator.zone).toBeNull();
      expect(repo.save).toHaveBeenCalledTimes(3);
      expect(cleared).not.toHaveProperty('passwordHash');
    });

    it.each([OperatorRole.ADMIN, OperatorRole.CASHIER])(
      'always clears a supplied zone for a %s',
      async (role) => {
        const operator = makeOperator({ role, zone: 'Legacy Zone' });
        const { service } = build({
          findOne: jest.fn().mockResolvedValue(operator),
        });

        const updated = await service.updateZone(operator.id, 'Zone B');

        expect(updated.zone).toBeNull();
        expect(updated).not.toHaveProperty('passwordHash');
      },
    );

    it('throws OPERATOR.NOT_FOUND for a missing operator', async () => {
      const { service, repo } = build({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const error = await service
        .updateZone('75764d4d-c61f-442d-a5ce-e61666fe12f5', 'Zone A')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'OPERATOR.NOT_FOUND',
      });
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('findAll returns safe projections without password hashes', async () => {
    const rows = [
      makeOperator(),
      makeOperator({
        id: '329a94f6-9973-4ab1-af20-f727df22fed2',
        username: 'admin',
        role: OperatorRole.ADMIN,
        zone: null,
      }),
    ];
    const { service } = build({
      find: jest.fn().mockResolvedValue(rows),
    });

    const result = await service.findAll();

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: rows[0].id,
      username: rows[0].username,
      zone: 'Zone A',
    });
    expect(result.every((operator) => !('passwordHash' in operator))).toBe(true);
  });
});
