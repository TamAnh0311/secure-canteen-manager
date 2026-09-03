import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'VALIDATION.USERNAME_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.USERNAME_REQUIRED' })
  @MaxLength(100, { message: 'VALIDATION.USERNAME_MAX' })
  username!: string;

  @IsString({ message: 'VALIDATION.PASSWORD_STRING' })
  @IsNotEmpty({ message: 'VALIDATION.PASSWORD_REQUIRED' })
  @MaxLength(200, { message: 'VALIDATION.PASSWORD_MAX' })
  password!: string;
}
