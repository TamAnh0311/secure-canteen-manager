import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ListOmrFormRosterDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  zone!: string;

  // Omission means the explicit null/blank-cell roster option.
  @Transform(({ value }) => trim(value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  cell?: string;
}
