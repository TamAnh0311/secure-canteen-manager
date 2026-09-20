import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface CreateAuditLogInput {
  operatorId: string;
  username: string;
  role: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  detail?: string | null;
  ip?: string | null;
}

export interface ListAuditLogsFilter {
  operatorId?: string;
  action?: string;
  resource?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /** Append an audit entry. Fire-and-forget — never throws to the caller. */
  async log(input: CreateAuditLogInput): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          operatorId: input.operatorId,
          username: input.username,
          role: input.role,
          action: input.action,
          resource: input.resource,
          resourceId: input.resourceId ?? null,
          method: input.method,
          path: input.path,
          statusCode: input.statusCode,
          detail: input.detail ?? null,
          ip: input.ip ?? null,
        }),
      );
    } catch {
      // Audit logging must never break a request. Silently drop on failure.
    }
  }

  /** List audit logs with optional filters, newest first. */
  async list(filter: ListAuditLogsFilter): Promise<AuditLog[]> {
    const qb = this.repo
      .createQueryBuilder('a')
      .orderBy('a.created_at', 'DESC')
      .take(filter.limit)
      .skip(filter.offset);

    if (filter.operatorId) {
      qb.andWhere('a.operator_id = :operatorId', { operatorId: filter.operatorId });
    }
    if (filter.action) {
      qb.andWhere('a.action = :action', { action: filter.action });
    }
    if (filter.resource) {
      qb.andWhere('a.resource = :resource', { resource: filter.resource });
    }
    if (filter.dateFrom) {
      qb.andWhere('a.created_at >= :dateFrom', { dateFrom: filter.dateFrom });
    }
    if (filter.dateTo) {
      qb.andWhere('a.created_at <= :dateTo', { dateTo: filter.dateTo + ' 23:59:59' });
    }

    return qb.getMany();
  }

  /** Count total audit entries matching the filter (for pagination). */
  async count(filter: Omit<ListAuditLogsFilter, 'limit' | 'offset'>): Promise<number> {
    const qb = this.repo.createQueryBuilder('a');

    if (filter.operatorId) {
      qb.andWhere('a.operator_id = :operatorId', { operatorId: filter.operatorId });
    }
    if (filter.action) {
      qb.andWhere('a.action = :action', { action: filter.action });
    }
    if (filter.resource) {
      qb.andWhere('a.resource = :resource', { resource: filter.resource });
    }
    if (filter.dateFrom) {
      qb.andWhere('a.created_at >= :dateFrom', { dateFrom: filter.dateFrom });
    }
    if (filter.dateTo) {
      qb.andWhere('a.created_at <= :dateTo', { dateTo: filter.dateTo + ' 23:59:59' });
    }

    return qb.getCount();
  }
}
