import { IsDateString, IsOptional } from 'class-validator';

export class MenuSummaryQueryDto {
  // Single service date (YYYY-MM-DD). Optional on the wire; the service defaults it to today
  // so the kitchen summary never sums selections across multiple dates.
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.SERVICE_DATE_FORMAT' })
  date?: string;
}
