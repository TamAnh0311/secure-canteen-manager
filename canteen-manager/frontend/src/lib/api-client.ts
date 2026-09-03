import i18n from '@/i18n';
import { clearToken, getToken } from '@/lib/token-storage';

const API_BASE = '/api';

// Fired on 401 so the auth layer can react without importing the router here.
const UNAUTHORIZED_EVENT = 'auth:unauthorized';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

// Look up a backend code in the `errors` namespace, falling back to the raw
// (English) text when the code is unknown so the UI never shows a blank.
function translateCode(code: string, fallback: string, values: Record<string, unknown> = {}): string {
  return i18n.t(`errors:${code}`, { defaultValue: fallback, ...values });
}

// Single source of truth for turning an error response body into a localized
// message. Used by both apiFetch and the image-fetch path so behavior stays
// consistent. Handles three shapes:
//   { code, message }     → domain exception: translate code, fall back to message
//   { message: string[] } → validation: each item is a code; translate + join
//   { message: string }   → translate as a possible code, else show as-is
export function translateApiError(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const body = parsed as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string' && body.code) {
      const raw = typeof body.message === 'string' ? body.message : body.code;
      return translateCode(body.code, raw, body as Record<string, unknown>);
    }
    if (Array.isArray(body.message)) {
      const joined = body.message
        .map((item) => translateCode(String(item), String(item)))
        .join(', ');
      return joined || fallback;
    }
    if (typeof body.message === 'string' && body.message) {
      return translateCode(body.message, body.message);
    }
  }
  if (typeof parsed === 'string' && parsed) return parsed;
  return fallback;
}

async function parseErrorMessage(res: Response): Promise<string> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as unknown;
    return translateApiError(body, fallback);
  } catch {
    // body was not JSON — fall through to status text
    return fallback;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = buildHeaders(init.headers);

  const res = await fetch(url, { ...init, headers });

  if (res.status === 204) {
    // No content — callers that expect void cast accordingly.
    return undefined as unknown as T;
  }

  if (!res.ok) {
    const rawBody = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }

    const msg = translateApiError(parsed, res.statusText || `HTTP ${res.status}`);

    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }

    throw new ApiError(res.status, msg, parsed);
  }

  return res.json() as Promise<T>;
}

// Streamed binary endpoints (e.g. the warped sheet image) require the same
// Bearer token as JSON calls, but a plain <img src> cannot carry it. Fetch the
// bytes here and hand back an object URL the caller can drop into an <img>.
// The caller owns the URL and MUST revoke it when done to avoid a memory leak.
export async function fetchImageObjectUrl(path: string): Promise<string> {
  const headers = new Headers();
  const token = getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { headers });

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(res.status, await parseErrorMessage(res), null);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Re-exported so callers can reference the event name without a magic string.
export { UNAUTHORIZED_EVENT };
