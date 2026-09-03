import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Fields that must never appear in logs — passwords, hashes, bearer tokens, and
// scan image payloads (base64 of handwritten forms = PII, and megabytes per request)
const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'imageBase64',
  'image_base64',
  'checksum',
  'sheetId',
  'batch',
]);

function sanitizeBody(body: unknown): unknown {
  if (Buffer.isBuffer(body)) return '[REDACTED_RAW_BODY]';
  if (typeof body !== 'object' || body === null) return body;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    sanitized[key] = SENSITIVE_FIELDS.has(key) ? '[REDACTED]' : value;
  }
  return sanitized;
}

function sanitizeUrl(url: string): string {
  return url.replace(/\/kiosk\/prisoner\/[^/?#]+/gi, '/kiosk/prisoner/[REDACTED]');
}

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url, body } = req;
    const safeUrl = sanitizeUrl(url);
    const start = Date.now();

    this.logger.log(`--> ${method} ${safeUrl} ${JSON.stringify(sanitizeBody(body))}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          this.logger.log(`<-- ${method} ${safeUrl} ${ms}ms`);
        },
        error: () => {
          const ms = Date.now() - start;
          this.logger.warn(`<-- ${method} ${safeUrl} ${ms}ms [error]`);
        },
      }),
    );
  }
}
