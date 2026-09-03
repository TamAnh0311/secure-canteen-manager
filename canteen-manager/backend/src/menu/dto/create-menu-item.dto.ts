import { IsString, IsNotEmpty, Length, IsInt, Min, Max, IsEnum } from 'class-validator';
import { MAX_VND } from '../../common/numeric.transformer';
import { MenuItemCategory } from '../menu-item-category.enum';

export class CreateMenuItemDto {
  @IsString({ message: 'VALIDATION.MENU_ITEM_NAME_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.MENU_ITEM_NAME_REQUIRED' })
  @Length(1, 255, { message: 'VALIDATION.MENU_ITEM_NAME_LENGTH' })
  name!: string;

  // Integer VND, 0 ≤ price ≤ MAX_VND (lossless under the bigint↔number transformer).
  @IsInt({ message: 'VALIDATION.MENU_ITEM_PRICE_INT' })
  @Min(0, { message: 'VALIDATION.MENU_ITEM_PRICE_MIN' })
  @Max(MAX_VND, { message: 'VALIDATION.MENU_ITEM_PRICE_MAX' })
  price!: number;

  @IsEnum(MenuItemCategory, { message: 'VALIDATION.MENU_ITEM_CATEGORY_ENUM' })
  category!: MenuItemCategory;
}
