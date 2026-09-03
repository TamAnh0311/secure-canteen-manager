import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AppEnv } from '../config/env-validation';

interface Counter {
  count: number;
  resetAt: number;
}

@Injectable()
export class KioskLookupRateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();
  private operations = 0;

  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store, private');

    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown-terminal';
    const limit = this.config.get('KIOSK_LOOKUP_RATE_LIMIT_PER_MINUTE', { infer: true });
    const current = this.counters.get(key);
    const counter = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + 60_000 }
      : current;

    counter.count += 1;
    this.counters.set(key, counter);
    if (++this.operations % 100 === 0) this.removeExpired(now);

    if (counter.count > limit) {
      throw new HttpException(
        { message: 'Too many lookup attempts', code: 'KIOSK.RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private removeExpired(now: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now) this.counters.delete(key);
    }
  }
}
