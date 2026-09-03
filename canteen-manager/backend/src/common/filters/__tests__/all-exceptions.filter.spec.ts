import { ArgumentsHost, BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from '../all-exceptions.filter';

// ---------------------------------------------------------------------------
// Helpers — minimal mock of ArgumentsHost / Request / Response
// ---------------------------------------------------------------------------

interface MockResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (body: unknown) => void;
}

function makeMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 0,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  return res;
}

function makeHost(res: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'GET', url: '/test' }),
    }),
  } as unknown as ArgumentsHost;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AllExceptionsFilter — code propagation', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('propagates code from a coded NotFoundException', () => {
    const res = makeMockResponse();
    filter.catch(new NotFoundException({ message: 'Sheet not found', code: 'SHEET.NOT_FOUND' }), makeHost(res));

    expect(res.statusCode).toBe(404);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe('SHEET.NOT_FOUND');
    expect(body['message']).toBe('Sheet not found');
  });

  it('propagates code from a coded BadRequestException', () => {
    const res = makeMockResponse();
    filter.catch(
      new BadRequestException({ message: 'Session config can only be changed while in draft status', code: 'SESSION.NOT_DRAFT' }),
      makeHost(res),
    );

    expect(res.statusCode).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe('SESSION.NOT_DRAFT');
    expect(body['message']).toBe('Session config can only be changed while in draft status');
  });

  it('propagates code from a coded UnauthorizedException', () => {
    const res = makeMockResponse();
    filter.catch(
      new UnauthorizedException({ message: 'Authentication required', code: 'AUTH.UNAUTHENTICATED' }),
      makeHost(res),
    );

    expect(res.statusCode).toBe(401);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe('AUTH.UNAUTHENTICATED');
    expect(body['message']).toBe('Authentication required');
  });

  it('propagates code AND extra fields from a ConflictException with dedup payload', () => {
    const res = makeMockResponse();
    filter.catch(
      new ConflictException({
        message: 'Duplicate scan: sheet already submitted',
        code: 'SHEET.DEDUP_CONFLICT',
        sheetId: 'sheet-abc',
        status: 'pending',
        id: 'uuid-123',
      }),
      makeHost(res),
    );

    expect(res.statusCode).toBe(409);
    const body = res.body as Record<string, unknown>;
    expect(body['code']).toBe('SHEET.DEDUP_CONFLICT');
    expect(body['sheetId']).toBe('sheet-abc');
    expect(body['id']).toBe('uuid-123');
  });

  it('handles plain-string exception (no code) without error', () => {
    const res = makeMockResponse();
    filter.catch(new BadRequestException('simple error'), makeHost(res));

    expect(res.statusCode).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(body['message']).toBe('simple error');
    expect(body['code']).toBeUndefined();
  });

  it('returns 500 for non-HTTP exceptions without leaking internals', () => {
    const res = makeMockResponse();
    filter.catch(new Error('unexpected crash'), makeHost(res));

    expect(res.statusCode).toBe(500);
    const body = res.body as Record<string, unknown>;
    expect(body['message']).toBe('Internal server error');
    expect(body['code']).toBeUndefined();
  });

  it('validation error array: message is string[] with VALIDATION codes', () => {
    const res = makeMockResponse();
    // Simulates what NestJS ValidationPipe produces for class-validator failures
    filter.catch(
      new BadRequestException({
        message: ['VALIDATION.USERNAME_REQUIRED', 'VALIDATION.PASSWORD_MIN'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      makeHost(res),
    );

    expect(res.statusCode).toBe(400);
    const body = res.body as Record<string, unknown>;
    expect(Array.isArray(body['message'])).toBe(true);
    expect(body['message']).toContain('VALIDATION.USERNAME_REQUIRED');
    expect(body['message']).toContain('VALIDATION.PASSWORD_MIN');
  });
});
