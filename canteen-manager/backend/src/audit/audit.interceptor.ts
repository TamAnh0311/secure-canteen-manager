import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { OperatorPublic } from '../operators/operator-public';

/** Fields redacted from the audit detail to avoid storing secrets. */
const REDACTED_FIELDS = new Set([
  'password', 'passwordHash', 'password_hash', 'token',
  'imageBase64', 'image_base64', 'pdfBase64', 'pdf_base64',
  'jwtSecret',
]);

/**
 * Maps HTTP method + route pattern to a human-readable action label.
 * Falls back to "{method} {resource}" if no specific mapping exists.
 */
function resolveAction(method: string, path: string): { action: string; resource: string; resourceId: string | null } {
  // Strip /api prefix and query string.
  const clean = path.replace(/^\/api\//, '').split('?')[0];
  const segments = clean.split('/');
  const resource = segments[0] ?? 'unknown';

  // Extract resource ID (UUID-shaped segment).
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resourceId = segments.find((s) => uuidPattern.test(s)) ?? null;

  // Named sub-actions from the last non-UUID segment.
  const lastSegment = segments.filter((s) => !uuidPattern.test(s)).pop();
  const subAction = lastSegment !== resource ? lastSegment : null;

  const actionMap: Record<string, Record<string, string>> = {
    POST: {
      menu: subAction === 'form' ? 'form.generate' : subAction === 'reorder' ? 'menu.reorder' : 'menu.create',
      orders: 'order.create',
      operators: 'operator.create',
      auth: 'auth.login',
      kiosk: 'kiosk.order',
    },
    PATCH: {
      menu: 'menu.update',
      operators: subAction === 'deactivate' ? 'operator.deactivate' : subAction === 'zone' ? 'operator.zone_update' : 'operator.update',
      'purchase-limit-config': 'config.purchase_limit_update',
      counter: subAction === 'accept' ? 'order.accept' : subAction === 'reject' ? 'order.reject' : 'counter.update',
    },
    DELETE: {
      menu: 'menu.delete',
    },
    PUT: {
      'payment-config': 'config.payment_update',
    },
  };

  const action = actionMap[method]?.[resource] ?? `${method.toLowerCase()}.${resource}`;
  return { action, resource, resourceId };
}

/** Redact sensitive fields from the request body for audit storage. */
function sanitizeBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    sanitized[key] = REDACTED_FIELDS.has(key) ? '[REDACTED]' : value;
  }
  // Cap at 2KB to avoid bloating the audit table with large payloads.
  const json = JSON.stringify(sanitized);
  return json.length > 2048 ? json.slice(0, 2045) + '...' : json;
}

/**
 * Global interceptor that records an audit log entry for every mutating
 * request (POST/PATCH/PUT/DELETE) made by an authenticated operator.
 * Runs after the handler completes so it can capture the response status.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method } = req;

    // Only audit mutating requests.
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle();
    }

    // Skip unauthenticated requests (public endpoints like kiosk, health).
    const user = (req as unknown as { user?: OperatorPublic }).user;
    if (!user) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          this.record(req, user, res.statusCode);
        },
        error: (err: unknown) => {
          const statusCode = (err as { status?: number }).status ?? 500;
          this.record(req, user, statusCode);
        },
      }),
    );
  }

  private record(req: Request, user: OperatorPublic, statusCode: number): void {
    const { action, resource, resourceId } = resolveAction(req.method, req.originalUrl);
    this.auditService.log({
      operatorId: user.id,
      username: user.username,
      role: user.role,
      action,
      resource,
      resourceId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode,
      detail: sanitizeBody(req.body),
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
  }
}
