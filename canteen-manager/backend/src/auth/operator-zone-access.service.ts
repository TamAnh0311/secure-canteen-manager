import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { normalizeZone } from '../common/zone-normalization';
import { OperatorRole } from '../operators/operator.entity';
import { OperatorPublic } from '../operators/operator-public';
import { User } from '../users/user.entity';

@Injectable()
export class OperatorZoneAccessService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  requireOperatorZone(actor: OperatorPublic): string | null {
    if (actor.role !== OperatorRole.OPERATOR) return null;
    const zone = normalizeZone(actor.zone);
    if (!zone) {
      throw new ForbiddenException({
        message: 'Operator zone assignment required',
        code: 'AUTH.OPERATOR_ZONE_REQUIRED',
      });
    }
    return zone;
  }

  scopeByUser<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    actor: OperatorPublic,
    userExpression: string,
    parameter = 'operatorZone',
  ): SelectQueryBuilder<T> {
    const zone = this.requireOperatorZone(actor);
    if (zone) {
      qb.andWhere(`BTRIM(${userExpression}) = :${parameter}`, { [parameter]: zone });
    }
    return qb;
  }

  scopeByUserId<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    actor: OperatorPublic,
    userIdExpression: string,
    parameter = 'operatorZone',
  ): SelectQueryBuilder<T> {
    const zone = this.requireOperatorZone(actor);
    if (zone) {
      qb.andWhere(
        `EXISTS (
          SELECT 1
          FROM "users" "zone_scope_user"
          WHERE "zone_scope_user"."id" = ${userIdExpression}
            AND BTRIM("zone_scope_user"."zone") = :${parameter}
        )`,
        { [parameter]: zone },
      );
    }
    return qb;
  }

  async assertUserAccess(
    actor: OperatorPublic,
    userId: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<User> {
    const zone = this.requireOperatorZone(actor);
    const repo = manager ? manager.getRepository(User) : this.users;
    const qb = repo.createQueryBuilder('zone_user').where('zone_user.id = :userId', { userId });
    if (zone) {
      qb.andWhere('BTRIM(zone_user.zone) = :operatorZone', { operatorZone: zone });
    }
    if (lock) qb.setLock('pessimistic_read');
    const user = await qb.getOne();
    if (!user) {
      throw new NotFoundException({ message: 'User not found', code: 'USER.NOT_FOUND' });
    }
    return user;
  }
}
