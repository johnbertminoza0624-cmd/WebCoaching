'use client';

/**
 * The single way the browser talks to the API.
 *
 * Every call sends cookies (`credentials: 'include'`) because the access and
 * refresh tokens are httpOnly — the app never holds a token in JavaScript, so
 * there is nothing for an injected script to steal.
 *
 * A 401 triggers exactly one refresh-and-retry. The refresh is shared across
 * concurrent callers: a page that fires five requests on load must not send
 * five refreshes, because refresh tokens rotate and the losers would present a
 * token that has just been revoked — which the API treats as theft and
 * responds to by killing every session.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** In-flight refresh, so concurrent 401s wait on one request rather than racing. */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Cross-tab refresh coordination.
 *
 * `refreshInFlight` only dedupes within one tab. Tabs share a cookie jar, so
 * two tabs that fall due at the same moment both POST /auth/refresh with the
 * same refresh token. Rotation means the first rotates it and the second
 * presents one that was just revoked — which the API reads as a stolen token
 * and answers by revoking every session for that user. The user is signed out
 * of every tab for doing nothing but having the app open twice.
 *
 * The Web Locks API serialises the refresh across tabs of the same origin. The
 * tab that wins the lock refreshes; the others wait, then see the timestamp it
 * wrote and skip straight to retrying their request with the new cookie
 * already in the jar.
 */
const REFRESH_LOCK = 'awr:auth-refresh';
const REFRESHED_AT_KEY = 'awr:auth-refreshed-at';
/** How long after a successful refresh a waiting tab may reuse that result. */
const REFRESH_FRESH_MS = 10_000;

function markRefreshed() {
  try {
    localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
  } catch {
    // Private mode / storage disabled — the lock alone still serialises tabs.
  }
}

function refreshedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(REFRESHED_AT_KEY) ?? 0);
    return at > 0 && Date.now() - at < REFRESH_FRESH_MS;
  } catch {
    return false;
  }
}

async function postRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) markRefreshed();
    return res.ok;
  } catch {
    return false;
  }
}

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      // Safari <15.4 and any non-secure context have no Web Locks; there the
      // in-tab dedupe above is all we get, and the server-side grace window in
      // `AuthService.refresh` is what stops a race becoming a mass sign-out.
      if (!locks) return await postRefresh();

      return await locks.request(REFRESH_LOCK, async () => {
        // Whoever held the lock before us may already have done the work. The
        // new cookie is in the shared jar, so there is nothing left to do.
        if (refreshedRecently()) return true;
        return postRefresh();
      });
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before a new refresh can start.
      queueMicrotask(() => { refreshInFlight = null; });
    }
  })();
  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for the auth calls themselves, which must not try to refresh. */
  skipRefresh?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh, headers, ...rest } = options;

  const send = () => fetch(`${API_BASE}/api${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let res = await send();

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send();
  }

  if (!res.ok) {
    let parsed: unknown;
    let message = res.statusText;
    try {
      parsed = await res.json();
      const m = (parsed as { message?: string | string[] })?.message;
      if (m) message = Array.isArray(m) ? m.join(', ') : m;
    } catch {
      // A non-JSON error body is not worth failing over; the status carries it.
    }
    throw new ApiError(res.status, message, parsed);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
};
