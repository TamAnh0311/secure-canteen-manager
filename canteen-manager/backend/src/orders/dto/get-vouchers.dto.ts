import { IsOptional, IsDateString } from 'class-validator';

export class GetVouchersDto {
  // Delivery date to print vouchers for (YYYY-MM-DD). Optional — the service defaults it to
  // today in the deploy timezone (vouchers are printed on the delivery morning).
  @IsOptional()
  @IsDateString({}, { message: 'VALIDATION.DATE_ISO' })
  date?: string;
}
