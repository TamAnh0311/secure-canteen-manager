import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsInt, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { MAX_VND } from '../../common/numeric.transformer';

export class PurchaseLimitRuleDto {
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_VND)
  amount!: number | null;
}

export class PurchaseLimitCategoryMatrixDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PurchaseLimitRuleDto)
  food!: PurchaseLimitRuleDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => PurchaseLimitRuleDto)
  essential!: PurchaseLimitRuleDto;
}

export class UpdatePurchaseLimitConfigDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => PurchaseLimitCategoryMatrixDto)
  prisoner!: PurchaseLimitCategoryMatrixDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => PurchaseLimitCategoryMatrixDto)
  visitor!: PurchaseLimitCategoryMatrixDto;
}
