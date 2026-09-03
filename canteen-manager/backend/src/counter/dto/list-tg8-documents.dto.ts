import { IsDateString, IsOptional, Matches } from 'class-validator';

export class ListTg8DocumentsDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'VALIDATION.DATE_ISO' })
  @IsDateString({ strict: true }, { message: 'VALIDATION.DATE_ISO' })
  date?: string;
}
