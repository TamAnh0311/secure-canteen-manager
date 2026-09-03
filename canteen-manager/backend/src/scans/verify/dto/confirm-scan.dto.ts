import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderLineItemDto {
  @IsUUID('4', { message: 'VALIDATION.MENU_ITEM_ID_UUID' })
  menuItemId!: string;

  // Per-line quantity written on the form; validated server-side [1,99].
  @IsInt({ message: 'VALIDATION.QUANTITY_INT' })
  @Min(1, { message: 'VALIDATION.QUANTITY_MIN' })
  @Max(99, { message: 'VALIDATION.QUANTITY_MAX' })
  quantity!: number;
}

export class ConfirmScanDto {
  @IsOptional()
  @IsUUID('4', { message: 'VALIDATION.USER_ID_UUID' })
  userId?: string;

  // Operator-confirmed order lines from the handwritten code+qty form.
  // At least one is required: a confirmed sheet always yields an order; a sheet with
  // nothing to order is Rejected instead.
  @IsArray({ message: 'VALIDATION.ITEMS_ARRAY' })
  @ArrayMinSize(1, { message: 'VALIDATION.ITEMS_MIN' })
  @ValidateNested({ each: true })
  @Type(() => OrderLineItemDto)
  items!: OrderLineItemDto[];

  @IsOptional()
  @IsBoolean({ message: 'VALIDATION.REPLACEMENT_ACK_BOOLEAN' })
  replacementAck?: boolean;

  @IsOptional()
  @IsString({ message: 'VALIDATION.IDENTITY_REASON_STRING' })
  @MaxLength(500, { message: 'VALIDATION.IDENTITY_REASON_MAX' })
  reason?: string;
}
