// Session storage + refresh coordination.
//
//   loadSession()     → { access_token, refresh_token } | null
//   saveSession(s)    → persists + updates in-memory cache + notifies
//   clearSession()    → wipes + notifies 'auth:expired'
//   getAccessToken()  → in-memory first, falls back to localStorage
//   refreshSession()  → single-flight: concurrent callers share one promise
//
// The refresh mutex matters because when the app boots, several hooks
// (useAuth's getMe, useApplication's initial fetch) may fire in parallel
// and each may see a 401. Without the mutex we'd hit the refresh endpoint
// N times and possibly invalidate each other's tokens.

const STORAGE_KEY = "artpark_eir_session";

let _memorySession = null;

function _readFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.access_token) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function loadSession() {
  if (_memorySession) return _memorySession;
  _memorySession = _readFromStorage();
  return _memorySession;
}

export function saveSession(session) {
  if (!session || !session.access_token || !session.refresh_token) {
    throw new Error("saveSession: invalid session shape");
  }
  _memorySession = { ...session };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_memorySession));
  } catch {
    // Quota or privacy mode — in-memory is still valid for this tab.
  }
  window.dispatchEvent(new CustomEvent("auth:session-saved", { detail: _memorySession }));
}

export function clearSession() {
  _memorySession = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent("auth:expired"));
}

export function getAccessToken() {
  const s = loadSession();
  return s ? s.access_token : null;
}

// ─── Refresh mutex ────────────────────────────────────────────────
//
// Only one refresh request is ever in flight per tab. If a second caller
// arrives mid-flight, it awaits the same promise. On success, both resume
// with the new access token.
let _refreshPromise = null;

// Injected by api.js to avoid a circular import. Has to be a function
// reference, not a direct import, because lib/api.js itself imports from
// this module.
let _doRefreshCall = null;
export function _setRefreshCaller(fn) {
  _doRefreshCall = fn;
}

export function refreshSession() {
  if (!_doRefreshCall) {
    // If api.js hasn't wired the caller yet, the best we can do is reject
    // so the caller can fall back to clearing the session.
    return Promise.reject(new Error("refreshSession caller not configured"));
  }
  if (_refreshPromise) return _refreshPromise;

  const current = loadSession();
  if (!current || !current.refresh_token) {
    _refreshPromise = Promise.reject(new Error("no refresh token"));
    // Clear the single-flight slot once the rejection is handled.
    _refreshPromise.catch(() => {
      _refreshPromise = null;
    });
    return _refreshPromise;
  }

  _refreshPromise = _doRefreshCall(current.refresh_token)
    .then((newSession) => {
      saveSession(newSession);
      return newSession;
    })
    .finally(() => {
      _refreshPromise = null;
    });

  return _refreshPromise;
}

// Test hook — lets unit tests reset module state between runs.
export function _resetSessionForTests() {
  _memorySession = null;
  _refreshPromise = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
