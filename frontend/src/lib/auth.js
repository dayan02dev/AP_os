// Auth flows — thin wrappers over the FastAPI /auth/* endpoints.
// All auth traffic goes through our backend (not supabase-js direct) so
// rate limiting, audit logging, and error shapes are uniform.

import { api } from "./api.js";
import { clearSession, saveSession } from "./session.js";

/**
 * Request a 6-digit OTP to the given email.
 * Response is intentionally generic — never reveals whether the email exists.
 */
export async function requestOtp(email) {
  return api.post("/auth/request-otp", { email });
}

/**
 * Verify the 6-digit OTP. On success, saves the session and returns
 * the user summary.
 */
export async function verifyOtp(email, token) {
  const result = await api.post("/auth/verify-otp", { email, token });
  if (!result || !result.access_token || !result.refresh_token) {
    throw new Error("verify-otp response missing tokens");
  }
  saveSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
  return result.user;
}

/**
 * Current profile (GET /auth/me). Assumes a session exists.
 */
export async function getMe() {
  return api.get("/auth/me");
}

/**
 * Best-effort logout — server-side call is a courtesy; the real effect
 * is dropping the local session tokens.
 */
export async function logout() {
  try {
    await api.post("/auth/logout", null);
  } catch {
    /* server failure on logout is not user-visible */
  }
  clearSession();
}
