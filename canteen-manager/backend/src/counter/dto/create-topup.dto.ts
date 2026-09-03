import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_VND } from '../../common/numeric.transformer';

// Cashier records a balance top-up. Amount is integer VND within the sane ceiling;
// method is the tender taken at the counter; ref is an optional receipt/transfer id.
export class CreateTopupDto {
  @IsString({ message: 'VALIDATION.PRISON_ID_STRING' })
  prisonId!: string;

  @IsInt({ message: 'VALIDATION.AMOUNT_INT' })
  @Min(1, { message: 'VALIDATION.AMOUNT_MIN' })
  @Max(MAX_VND, { message: 'VALIDATION.AMOUNT_MAX' })
  amount!: number;

  @IsIn(['cash', 'bank'], { message: 'VALIDATION.METHOD_CASH_BANK' })
  method!: string;

  @IsOptional()
  @IsString({ message: 'VALIDATION.REF_STRING' })
  @MaxLength(255, { message: 'VALIDATION.REF_MAX' })
  ref?: string;
}
