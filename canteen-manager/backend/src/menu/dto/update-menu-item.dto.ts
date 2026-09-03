import { IsString, IsOptional, IsBoolean, Length, IsInt, Min, Max, IsEnum } from 'class-validator';
import { MAX_VND } from '../../common/numeric.transformer';
import { MenuItemCategory } from '../menu-item-category.enum';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString({ message: 'VALIDATION.MENU_ITEM_NAME_STRING' })
  @Length(1, 255, { message: 'VALIDATION.MENU_ITEM_NAME_LENGTH' })
  name?: string;

  @IsOptional()
  @IsInt({ message: 'VALIDATION.MENU_ITEM_PRICE_INT' })
  @Min(0, { message: 'VALIDATION.MENU_ITEM_PRICE_MIN' })
  @Max(MAX_VND, { message: 'VALIDATION.MENU_ITEM_PRICE_MAX' })
  price?: number;

  @IsOptional()
  @IsBoolean({ message: 'VALIDATION.IS_ACTIVE_BOOLEAN' })
  isActive?: boolean;

  @IsOptional()
  @IsEnum(MenuItemCategory, { message: 'VALIDATION.MENU_ITEM_CATEGORY_ENUM' })
  category?: MenuItemCategory;
}
