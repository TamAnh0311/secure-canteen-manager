import { IsInt, IsUUID, Max, Min } from 'class-validator';

// One requested line on a visitor order: a menu item plus how many portions of it.
// Shared by the counter and kiosk DTOs (DRY). Quantity is bounded 1..99 here at the wire
// edge; the orders funnel re-checks the same bound server-side as the money trust boundary,
// because the omr/verify path builds its lines in code and never passes through this DTO.
export class OrderLineItemDto {
  @IsUUID('4', { message: 'VALIDATION.MENU_ITEM_IDS_UUID' })
  menuItemId!: string;

  @IsInt({ message: 'VALIDATION.QUANTITY_INT' })
  @Min(1, { message: 'VALIDATION.QUANTITY_RANGE' })
  @Max(99, { message: 'VALIDATION.QUANTITY_RANGE' })
  quantity!: number;
}
