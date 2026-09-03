import { IsOptional, IsEnum, IsUUID, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '../order.entity';

export class ListOrdersDto {
  // Inclusive lower bound on service_date (YYYY-MM-DD). Caller defaults to today.
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom?: string;

  // Inclusive upper bound on service_date (YYYY-MM-DD). Caller defaults to today.
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo?: string;

  @IsOptional()
  @IsUUID('4', { message: 'VALIDATION.USER_ID_UUID' })
  userId?: string;

  @IsOptional()
  @IsEnum(OrderStatus, { message: 'VALIDATION.STATUS_ENUM' })
  status?: OrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'VALIDATION.LIMIT_INT' })
  @Min(0, { message: 'VALIDATION.LIMIT_MIN' })
  @Max(200, { message: 'VALIDATION.LIMIT_MAX' })
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'VALIDATION.OFFSET_INT' })
  @Min(0, { message: 'VALIDATION.OFFSET_MIN' })
  offset: number = 0;
}
