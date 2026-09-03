import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

// Cashier accepts a pending relative order. Body is optional: omit `method` to settle with the
// tender the visitor chose at create; supply cash/bank to override it (e.g. visitor switched to
// cash at the counter). Money never touches the balance either way.
//
// Bank settlement may also carry a transfer reference (bank txn id / last-4) and the received
// amount, both OPTIONAL. The received amount, when entered, must equal the order total or the
// accept is rejected server-side (ORDER.AMOUNT_MISMATCH).
export class AcceptOrderDto {
  @IsOptional()
  @IsIn(['cash', 'bank'], { message: 'VALIDATION.METHOD_CASH_BANK' })
  method?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'VALIDATION.TRANSFER_REFERENCE_TOO_LONG' })
  transferReference?: string;

  @IsOptional()
  @IsInt({ message: 'VALIDATION.RECEIVED_AMOUNT_INT' })
  @Min(0, { message: 'VALIDATION.RECEIVED_AMOUNT_INT' })
  receivedAmount?: number;
}
