import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListLedgerDto {
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
