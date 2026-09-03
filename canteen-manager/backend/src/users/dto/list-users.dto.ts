import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ListUsersDto {
  @IsOptional()
  @IsString({ message: 'VALIDATION.QUERY_STRING' })
  q?: string;

  @IsOptional()
  @IsString({ message: 'VALIDATION.ZONE_STRING' })
  zone?: string;

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
