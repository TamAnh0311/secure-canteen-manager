import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class ReorderMenuDto {
  // Full ordered list of item IDs — positions are re-assigned 0..N-1 in this order
  @IsArray({ message: 'VALIDATION.ORDERED_ITEM_IDS_ARRAY' })
  @ArrayMinSize(1, { message: 'VALIDATION.ORDERED_ITEM_IDS_MIN' })
  @IsUUID('4', { each: true, message: 'VALIDATION.ORDERED_ITEM_IDS_UUID' })
  orderedItemIds!: string[];
}
