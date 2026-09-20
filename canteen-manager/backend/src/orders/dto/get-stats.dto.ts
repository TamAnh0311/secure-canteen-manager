import { IsOptional, IsDateString } from 'class-validator';

/**
 * Query parameters for the dashboard stats endpoint.
 * Both date bounds are optional; the service defaults to today in the deploy timezone.
 */
export class GetStatsDto {
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo?: string;
}
