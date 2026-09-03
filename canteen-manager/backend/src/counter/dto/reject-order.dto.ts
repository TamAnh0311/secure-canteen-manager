import { IsOptional, IsString, MaxLength } from 'class-validator';

// Cashier rejects a pending relative order. The reason is optional free text (kept short for the
// audit trail) — e.g. "visitor left", "duplicate", "out of stock".
export class RejectOrderDto {
  @IsOptional()
  @IsString({ message: 'VALIDATION.REASON_STRING' })
  @MaxLength(200, { message: 'VALIDATION.REASON_MAX' })
  reason?: string;
}
