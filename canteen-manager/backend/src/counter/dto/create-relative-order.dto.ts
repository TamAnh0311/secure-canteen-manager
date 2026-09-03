import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';
import { OrderLineItemDto } from '../../orders/dto/order-line-item.dto';

// Cashier creates a relative's order for today, paid immediately by cash/bank. The balance is
// never touched; 'balance' as a method is rejected here (it is the omr-only tender). The order
// buckets to today's date server-side — no client-supplied date.
export class CreateRelativeOrderDto {
  @IsString({ message: 'VALIDATION.PRISON_ID_STRING' })
  prisonId!: string;

  // @Type + @ValidateNested make forbidNonWhitelisted recurse into each line, so per-line
  // quantity is range-checked and stray keys (e.g. an injected source/operatorId) are rejected.
  @IsArray({ message: 'VALIDATION.MENU_ITEM_IDS_ARRAY' })
  @ArrayMinSize(1, { message: 'VALIDATION.MENU_ITEM_IDS_MIN' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items!: OrderLineItemDto[];

  @IsIn(['cash', 'bank'], { message: 'VALIDATION.METHOD_CASH_BANK' })
  method!: string;
}
