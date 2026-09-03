import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_ZONE_LENGTH } from '../../common/zone-normalization';

export class UpdateOperatorZoneDto {
  @IsOptional()
  @IsString({ message: 'VALIDATION.ZONE_STRING' })
  @MaxLength(MAX_ZONE_LENGTH, { message: 'VALIDATION.ZONE_MAX' })
  zone!: string | null;
}
