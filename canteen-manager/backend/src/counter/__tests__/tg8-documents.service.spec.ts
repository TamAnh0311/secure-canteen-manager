import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Repository } from 'typeorm';
import { type AppEnv } from '../../config/env-validation';
import { OperatorRole } from '../../operators/operator.entity';
import { OperatorPublic } from '../../operators/operator-public';
import { Tg8Document } from '../../orders/tg8-document.entity';
import { ListTg8DocumentsDto } from '../dto/list-tg8-documents.dto';
import { Tg8DocumentsService } from '../tg8-documents.service';

/** Create a minimal ConfigService stub that returns the given DATABASE_TYPE. */
function mockConfig(dbType: 'postgres' | 'sqlite' = 'postgres') {
  return { get: () => dbType } as unknown as ConfigService<AppEnv, true>;
}

function actor(role: OperatorRole): OperatorPublic {
  return { id: 'operator-1', role } as OperatorPublic;
}

describe('Tg8DocumentsService.listRecentTg8', () => {
  it('returns minimum immutable metadata for the selected deploy-timezone date', async () => {
    process.env.APP_TZ = 'Asia/Ho_Chi_Minh';
    const documents = [
      {
        orderId: 'order-1',
        templateRevision: 'tg8-v1',
        acceptedAt: new Date('2026-07-17T04:00:00.000Z'),
        snapshot: {
          prisoner: { legacyId: 'P001', name: 'Nguyễn Văn A' },
          acceptedTotal: 125_000,
        },
      },
    ] as Tg8Document[];
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(documents),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<Tg8Document>;
    const service = new Tg8DocumentsService(repository, mockConfig('postgres'));

    await expect(
      service.listRecentTg8(actor(OperatorRole.CASHIER), '2026-07-17'),
    ).resolves.toEqual([
      {
        orderId: 'order-1',
        templateRevision: 'tg8-v1',
        acceptedAt: documents[0].acceptedAt,
        prisoner: { legacyId: 'P001', name: 'Nguyễn Văn A' },
        totalAmount: 125_000,
      },
    ]);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'CAST(document.accepted_at AT TIME ZONE :timeZone AS date) = CAST(:date AS date)',
    );
    expect(queryBuilder.setParameters).toHaveBeenCalledWith({
      timeZone: 'Asia/Ho_Chi_Minh',
      date: '2026-07-17',
    });
  });

  it('allows ADMIN but rejects OPERATOR before querying protected metadata', async () => {
    const repository = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<Tg8Document>;
    const service = new Tg8DocumentsService(repository, mockConfig('postgres'));

    await expect(
      service.listRecentTg8(actor(OperatorRole.OPERATOR), '2026-07-17'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});

describe('ListTg8DocumentsDto', () => {
  it('accepts only a real date-only value', async () => {
    await expect(
      validate(plainToInstance(ListTg8DocumentsDto, { date: '2026-07-17' })),
    ).resolves.toHaveLength(0);

    for (const date of ['2026-07-17T23:30:00-07:00', '2026-02-31', '17-07-2026']) {
      expect(await validate(plainToInstance(ListTg8DocumentsDto, { date }))).not.toHaveLength(0);
    }
  });
});
