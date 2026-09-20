import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { OperatorRole } from '../operators/operator.entity';
import { AuditService, ListAuditLogsFilter } from './audit.service';
import { AuditLog } from './audit-log.entity';
import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

/** Query DTO for listing audit logs. */
class ListAuditLogsDto {
  @IsOptional()
  @IsString()
  operatorId?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  resource?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

/**
 * Admin-only controller for viewing the operator audit trail.
 * All routes require ADMIN role.
 */
@Controller('audit')
@Roles(OperatorRole.ADMIN)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /** List audit log entries with optional filters, newest first. */
  @Get()
  async list(@Query() query: ListAuditLogsDto): Promise<{ data: AuditLog[]; total: number }> {
    const filter: ListAuditLogsFilter = {
      operatorId: query.operatorId,
      action: query.action,
      resource: query.resource,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      limit: query.limit,
      offset: query.offset,
    };
    const [data, total] = await Promise.all([
      this.auditService.list(filter),
      this.auditService.count(filter),
    ]);
    return { data, total };
  }
}
