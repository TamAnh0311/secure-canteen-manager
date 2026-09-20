import { IsDateString } from 'class-validator';

/** Query DTO for the range-based kitchen summary. Both dates required. */
export class MenuSummaryRangeQueryDto {
  @IsDateString({}, { message: 'VALIDATION.DATE_FROM_ISO' })
  dateFrom!: string;

  @IsDateString({}, { message: 'VALIDATION.DATE_TO_ISO' })
  dateTo!: string;
}
