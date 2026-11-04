// BS2 g7 — session/refresh fixes (S2-SH-02, 03, 15, 16).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiCall } from "../api.js";
import {
  _resetSessionForTests, loadSession, refreshSession, saveSession,
} from "../session.js";

const KEY = "artpark_eir_session";
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
  _resetSessionForTests();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("S2-SH-02 cross-tab", () => {
  it("a stale tab of user A does not overwrite user B's stored session", async () => {
    saveSession({ access_token: "A1", refresh_token: "RA1", user: { id: "user-a" } });
    localStorage.setItem(KEY, JSON.stringify({ access_token: "B1", refresh_token: "RB1", user: { id: "user-b" } }));
    fetch.mockResolvedValueOnce(json(200, { access_token: "A2", refresh_token: "RA2" }));
    await refreshSession();
    expect(JSON.parse(fetch.mock.calls[0][1].body).refresh_token).toBe("RA1");
    expect(JSON.parse(localStorage.getItem(KEY)).user.id).toBe("user-b");
  });

  it("another tab rotated the SAME user's tokens: refresh uses the fresh refresh token", async () => {
    saveSession({ access_token: "A1", refresh_token: "R1" });
    localStorage.setItem(KEY, JSON.stringify({ access_token: "A2", refresh_token: "R2" }));
    fetch.mockResolvedValueOnce(json(200, { access_token: "A3", refresh_token: "R3" }));
    await refreshSession();
    expect(JSON.parse(fetch.mock.calls[0][1].body).refresh_token).toBe("R2");
  });

  it("a failed stale refresh does not wipe another tab's good tokens", async () => {
    saveSession({ access_token: "A1", refresh_token: "R1", user: { id: "a" } });
    localStorage.setItem(KEY, JSON.stringify({ access_token: "B1", refresh_token: "RB", user: { id: "b" } }));
    fetch
      .mockResolvedValueOnce(json(401, { detail: "x" }))
      .mockResolvedValueOnce(json(401, { error: { code: "refresh_failed" } }));
    await expect(apiCall("/admin/platform/stats")).rejects.toBeTruthy();
    expect(JSON.parse(localStorage.getItem(KEY)).refresh_token).toBe("RB");
  });
});

describe("S2-SH-03 transient refresh failure keeps the session", () => {
  it("network error on /auth/refresh", async () => {
    saveSession({ access_token: "expired", refresh_token: "good-refresh" });
    fetch.mockResolvedValueOnce(json(401, { detail: "x" })).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const expired = vi.fn();
    window.addEventListener("auth:expired", expired);
    await expect(apiCall("/reviewer/queue")).rejects.toMatchObject({ status: 401 });
    expect(JSON.parse(localStorage.getItem(KEY)).refresh_token).toBe("good-refresh");
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener("auth:expired", expired);
  });

  it("429 and 5xx on /auth/refresh", async () => {
    for (const status of [429, 503]) {
      saveSession({ access_token: "expired", refresh_token: "good-refresh" });
      fetch.mockResolvedValueOnce(json(401, { detail: "x" })).mockResolvedValueOnce(json(status, { error: "x" }));
      await expect(apiCall("/leadership/stats")).rejects.toBeTruthy();
      expect(localStorage.getItem(KEY)).not.toBeNull();
    }
  });

  it("a genuinely rejected refresh token (401) still signs out", async () => {
    saveSession({ access_token: "expired", refresh_token: "dead" });
    fetch.mockResolvedValueOnce(json(401, { detail: "x" })).mockResolvedValueOnce(json(401, { error: "bad" }));
    await expect(apiCall("/leadership/stats")).rejects.toBeTruthy();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("S2-SH-15 download refreshes an expired token", () => {
  it("refreshes once and retries", async () => {
    saveSession({ access_token: "expired", refresh_token: "good-refresh" });
    fetch
      .mockResolvedValueOnce(json(401, { detail: "x" }))
      .mockResolvedValueOnce(json(200, { access_token: "N1", refresh_token: "N2" }))
      .mockResolvedValueOnce(new Response("pdf-bytes", { status: 200 }));
    const blob = await api.download("/leadership/applications/x/vip-memo-v2/download?format=pdf");
    expect(blob.size).toBe(9);
    expect(fetch.mock.calls[2][1].headers.get("Authorization")).toBe("Bearer N1");
    expect(loadSession().refresh_token).toBe("N2");
  });
});

describe("S2-SH-16 credential 401s are not token expiry", () => {
  it("wrong OTP: single call, existing session untouched", async () => {
    saveSession({ access_token: "still-valid", refresh_token: "R1" });
    fetch.mockResolvedValueOnce(json(401, { error: { code: "otp_invalid" } }));
    await expect(apiCall("/auth/verify-otp", { method: "POST", body: { email: "e@x.com", token: "111111" } }))
      .rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });
});
