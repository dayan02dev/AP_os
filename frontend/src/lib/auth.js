// Auth flows — thin wrappers over the FastAPI /auth/* endpoints.
// All auth traffic goes through our backend (not supabase-js direct) so
// rate limiting, audit logging, and error shapes are uniform.

import { api } from "./api.js";
import { clearSession, saveSession } from "./session.js";

/**
 * Request a 6-digit OTP to the given email.
 *
 * `track` is forwarded to Supabase user_metadata on the FIRST OTP request
 * (signup) so the handle_new_user() trigger can stamp profiles.track. For
 * existing users the field is ignored — track is locked once set. Pass
 * "tir" or "sip"; null/undefined falls back to the backend default ("tir").
 */
export async function requestOtp(email, track) {
  const body = { email };
  if (track === "tir" || track === "sip") body.track = track;
  return api.post("/auth/request-otp", body);
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
 * Sign in with email + password. Same return contract as verifyOtp:
 * saves the session and returns the user summary on success.
 */
export async function signInWithPassword(email, password) {
  const result = await api.post("/auth/sign-in-password", { email, password });
  if (!result || !result.access_token || !result.refresh_token) {
    throw new Error("sign-in-password response missing tokens");
  }
  saveSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
  return result.user;
}

/**
 * Set or change the password for the currently-authenticated user.
 * Bearer token is attached automatically by the api wrapper.
 */
export async function setPassword(password) {
  return api.post("/auth/set-password", { password });
}

/**
 * Current profile (GET /auth/me). Assumes a session exists.
 */
export async function getMe() {
  return api.get("/auth/me");
}

/**
 * Flip the user's profiles.track to "tir" or "sip".
 *
 * The chooser at /apply lets one applicant explore both tracks. SIP's RLS
 * policies (migration 011) gate every read/write on sip_applications +
 * SIP storage behind profiles.track='sip', so we must flip server-side
 * BEFORE navigating into the other wizard or RLS blocks drafting.
 *
 * Returns the new track on success. Throws on network / 4xx / 5xx so the
 * caller can decide whether to toast-and-still-navigate (preferred) or
 * abort — see auth_upload.jsx for the chooser wiring.
 */
export async function setMyTrack(track) {
  if (track !== "tir" && track !== "sip") {
    throw new Error(`setMyTrack: invalid track "${track}"`);
  }
  const result = await api.patch("/auth/me/track", { track });
  return result?.track ?? track;
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
