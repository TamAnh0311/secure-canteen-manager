import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator';
import { OrderLineItemDto } from '../../orders/dto/order-line-item.dto';

// A visitor places a pending order from the public kiosk. The fields are an exact whitelist:
// with the app's forbidNonWhitelisted pipe, any attempt to inject `source` or `operatorId`
// is rejected (400) — the origin is forced to 'relative' server-side so a kiosk request can
// never reach the balance-paying omr branch. The order buckets to today's date server-side
// (no client-supplied date). `method` is the intended tender (cash/bank); the order is created
// UNPAID and only a cashier flips it to paid on accept.
export class CreateKioskOrderDto {
  @IsString({ message: 'VALIDATION.PRISON_ID_STRING' })
  prisonId!: string;

  // @Type + @ValidateNested are load-bearing on this PUBLIC endpoint: without them the whitelist
  // does NOT recurse into a line object, so a client could smuggle source/operatorId inside a line
  // and reach the omr branch. With them, stray per-line keys are rejected (400).
  @IsArray({ message: 'VALIDATION.MENU_ITEM_IDS_ARRAY' })
  @ArrayMinSize(1, { message: 'VALIDATION.MENU_ITEM_IDS_MIN' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items!: OrderLineItemDto[];

  @IsIn(['cash', 'bank'], { message: 'VALIDATION.METHOD_CASH_BANK' })
  method!: string;
}
