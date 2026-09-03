import { IsEnum, IsInt, IsOptional, IsDateString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SheetStatus } from '../sheet-status.enum';

export class ListScansDto {
  // Inclusive lower bound on service_date (YYYY-MM-DD). Caller defaults to today.
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom?: string;

  // Inclusive upper bound on service_date (YYYY-MM-DD). Caller defaults to today.
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo?: string;

  @IsOptional()
  @IsEnum(SheetStatus, { message: 'VALIDATION.STATUS_ENUM' })
  status?: SheetStatus;

  @IsOptional()
  @IsInt({ message: 'VALIDATION.LIMIT_INT' })
  @Min(1, { message: 'VALIDATION.LIMIT_MIN' })
  @Max(200, { message: 'VALIDATION.LIMIT_MAX' })
  @Type(() => Number)
  limit: number = 50;

  @IsOptional()
  @IsInt({ message: 'VALIDATION.OFFSET_INT' })
  @Min(0, { message: 'VALIDATION.OFFSET_MIN' })
  @Type(() => Number)
  offset: number = 0;
}
