import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OperatorRole } from '../operator.entity';
import { MAX_ZONE_LENGTH } from '../../common/zone-normalization';

export class CreateOperatorDto {
  @IsString({ message: 'VALIDATION.USERNAME_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.USERNAME_REQUIRED' })
  @MaxLength(100, { message: 'VALIDATION.USERNAME_MAX' })
  username!: string;

  @IsString({ message: 'VALIDATION.PASSWORD_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.PASSWORD_REQUIRED' })
  @MinLength(8, { message: 'VALIDATION.PASSWORD_MIN' })
  @MaxLength(200, { message: 'VALIDATION.PASSWORD_MAX' })
  password!: string;

  @IsString({ message: 'VALIDATION.DISPLAY_NAME_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.DISPLAY_NAME_REQUIRED' })
  @MaxLength(200, { message: 'VALIDATION.DISPLAY_NAME_MAX' })
  displayName!: string;

  @IsEnum(OperatorRole, { message: 'VALIDATION.ROLE_ENUM' })
  role!: OperatorRole;

  @IsOptional()
  @IsString({ message: 'VALIDATION.ZONE_STRING' })
  @MaxLength(MAX_ZONE_LENGTH, { message: 'VALIDATION.ZONE_MAX' })
  zone?: string | null;
}
