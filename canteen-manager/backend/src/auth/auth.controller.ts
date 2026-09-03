import { Body, Controller, Get, HttpCode, HttpStatus, Post, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { OperatorPublic } from '../operators/operator-public';

interface LoginResponse {
  token: string;
  operator: OperatorPublic;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.validateAndLogin(dto.username, dto.password);
  }

  // req.user is the resolved OperatorPublic set by JwtStrategy.validate()
  @Get('me')
  me(@Request() req: { user: OperatorPublic }): OperatorPublic {
    return req.user;
  }
}
