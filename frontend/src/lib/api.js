// Fetch wrapper for the FastAPI backend.
//
//   apiCall(path, { method, body, headers, timeoutMs, signal })
//
// Behaviour:
//   - Prepends VITE_API_BASE_URL (falls back to '' so same-origin still works)
//   - Auto-attaches Authorization: Bearer <access_token> when a session exists
//   - JSON bodies get stringified + Content-Type set
//   - FormData bodies pass through (resume upload path)
//   - On 401:
//       * call refreshSession() (single-flight, see lib/session.js)
//       * retry the request ONCE with the new token
//       * if retry also 401, clearSession() and throw ApiError
//   - Any non-2xx response throws ApiError({status, code, message, details})
//   - Timeouts default to 30s, 60s for /resume/upload
//   - Backend returns {"error": {code, message, ...}} — we unwrap that here

import {
  clearSession,
  getAccessToken,
  refreshSession,
  _setRefreshCaller,
} from "./session.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;

function baseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL || "";
  return raw.replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message || "API error");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function _buildError(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* non-JSON body is fine */
  }

  // Our backend's shape: { error: { code, message, ... } }
  if (data && data.error && typeof data.error === "object") {
    return new ApiError({
      status: response.status,
      code: data.error.code,
      message: data.error.message,
      details: data.error,
    });
  }
  // FastAPI default shape: { detail: ... }
  if (data && "detail" in data) {
    return new ApiError({
      status: response.status,
      code: `http_${response.status}`,
      message: typeof data.detail === "string" ? data.detail : "Request failed",
      details: data.detail,
    });
  }
  return new ApiError({
    status: response.status,
    code: `http_${response.status}`,
    message: response.statusText || "Request failed",
    details: data,
  });
}

function _buildHeaders({ body, headers }) {
  const out = new Headers(headers || {});
  const token = getAccessToken();
  if (token && !out.has("Authorization")) {
    out.set("Authorization", `Bearer ${token}`);
  }
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    if (!out.has("Content-Type")) out.set("Content-Type", "application/json");
  }
  return out;
}

function _serializeBody(body) {
  if (body === undefined || body === null) return undefined;
  if (body instanceof FormData) return body;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

async function _runRequest(path, opts) {
  const url = path.startsWith("http") ? path : `${baseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Merge caller's signal (e.g. React unmount) with our timeout.
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, {
      method: opts.method || "GET",
      headers: _buildHeaders(opts),
      body: _serializeBody(opts.body),
      signal: controller.signal,
      credentials: "omit",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call the backend. Auth is transparent: if a session exists the token
 * is attached and refreshed on 401.
 *
 * @param {string} path e.g. "/applications/me"
 * @param {object} opts
 * @param {"GET"|"POST"|"PATCH"|"DELETE"|"PUT"} [opts.method]
 * @param {any} [opts.body] JSON-serialisable or FormData
 * @param {object} [opts.headers]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<any>} parsed JSON or null for 204
 */
export async function apiCall(path, opts = {}) {
  let response;
  try {
    response = await _runRequest(path, opts);
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new ApiError({
        status: 0,
        code: "timeout",
        message: "Request timed out",
      });
    }
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: err?.message || "Network error",
    });
  }

  if (response.status === 401) {
    // Second consecutive 401 → the refreshed token was also rejected (or the
    // session was cleared mid-flight). Give up cleanly.
    if (opts._isRetry) {
      clearSession();
      throw await _buildError(response);
    }
    // No token to refresh → just bubble.
    if (!getAccessToken()) {
      throw await _buildError(response);
    }
    // First 401 with a token — try to refresh, then retry the original call.
    try {
      await refreshSession();
    } catch {
      clearSession();
      throw await _buildError(response);
    }
    return apiCall(path, { ...opts, _isRetry: true });
  }

  if (response.status === 204) return null;

  if (response.ok) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  throw await _buildError(response);
}

// Convenience helpers so callers read naturally.
export const api = {
  get: (path, opts = {}) => apiCall(path, { ...opts, method: "GET" }),
  post: (path, body, opts = {}) => apiCall(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts = {}) => apiCall(path, { ...opts, method: "PATCH", body }),
  del: (path, opts = {}) => apiCall(path, { ...opts, method: "DELETE" }),
};

// Register the refresh-caller with session.js. Using a plain fetch here
// (no recursive apiCall) so the 401-retry loop can't bounce through refresh.
_setRefreshCaller(async (refreshToken) => {
  const response = await fetch(`${baseUrl()}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
    credentials: "omit",
  });
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      code: "refresh_failed",
      message: "Failed to refresh session",
    });
  }
  const data = await response.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  };
});

export { UPLOAD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS };
