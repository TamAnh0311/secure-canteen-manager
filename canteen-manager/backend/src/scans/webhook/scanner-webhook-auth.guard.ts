import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { AppEnv } from '../../config/env-validation';

@Injectable()
export class ScannerWebhookAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get('SCANNER_CALLBACK_TOKEN', { infer: true });
    const authorization = context.switchToHttp().getRequest<Request>().headers.authorization;
    if (!expected || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      throw this.unauthorized();
    }
    const provided = authorization.slice('Bearer '.length);
    if (!this.matches(provided, expected)) throw this.unauthorized();
    return true;
  }

  private matches(provided: string, expected: string): boolean {
    const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();
    return timingSafeEqual(digest(provided), digest(expected));
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'SCANNER.AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    });
  }
}
