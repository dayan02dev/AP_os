// api.js contract tests.
// Uses Vitest's `vi.fn()` stub for global fetch — never hits the real network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiCall } from "../api.js";
import { _resetSessionForTests, loadSession, saveSession } from "../session.js";

// Minimal Response helper — avoids depending on undici/node fetch internals.
function jsonResponse(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
    ...extra,
  });
}

describe("apiCall", () => {
  beforeEach(() => {
    _resetSessionForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches Authorization header when a session exists", async () => {
    saveSession({ access_token: "access-1", refresh_token: "refresh-1" });
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    await apiCall("/auth/me");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.get("Authorization")).toBe("Bearer access-1");
  });

  it("throws ApiError with backend-shaped details on non-2xx", async () => {
    globalThis.fetch.mockResolvedValue(
      jsonResponse(400, {
        error: { code: "bad_input", message: "Oops", field: "email" },
      }),
    );

    await expect(apiCall("/thing")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "bad_input",
      message: "Oops",
    });
  });

  it("refreshes then retries once on 401", async () => {
    saveSession({ access_token: "stale", refresh_token: "refresh-1" });

    const fetchMock = globalThis.fetch;
    fetchMock
      // first call: 401
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "expired", message: "Token expired" } }),
      )
      // refresh call (invoked by session._doRefreshCall → raw fetch):
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "fresh", refresh_token: "refresh-2" }),
      )
      // retry with new token
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiCall("/applications/me");
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstCallHeaders = fetchMock.mock.calls[0][1].headers;
    const retryCallHeaders = fetchMock.mock.calls[2][1].headers;
    expect(firstCallHeaders.get("Authorization")).toBe("Bearer stale");
    expect(retryCallHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("clears session + throws when the refresh-retry also 401s", async () => {
    saveSession({ access_token: "stale", refresh_token: "refresh-1" });

    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "expired" } }))
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: "fresh", refresh_token: "refresh-2" }),
      )
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "expired_again" } }));

    let listenerHit = false;
    const onExpired = () => {
      listenerHit = true;
    };
    window.addEventListener("auth:expired", onExpired);

    await expect(apiCall("/applications/me")).rejects.toBeInstanceOf(ApiError);
    window.removeEventListener("auth:expired", onExpired);

    // Session wiped because retry also failed.
    expect(loadSession()).toBeNull();
  });

  it("serialises the body as JSON by default", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { ok: true }));
    await apiCall("/support/ticket", {
      method: "POST",
      body: { email: "a@b.c", subject: "hi", body: "x", category: "technical" },
    });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(typeof opts.body).toBe("string");
    expect(JSON.parse(opts.body)).toEqual({
      email: "a@b.c",
      subject: "hi",
      body: "x",
      category: "technical",
    });
    expect(opts.headers.get("Content-Type")).toBe("application/json");
  });

  it("passes FormData through unmodified", async () => {
    globalThis.fetch.mockResolvedValue(jsonResponse(200, { ok: true }));
    const fd = new FormData();
    fd.append("file", new Blob(["hello"]), "resume.pdf");
    await apiCall("/resume/upload", { method: "POST", body: fd });
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.body).toBe(fd);
    // Browser sets its own multipart Content-Type with boundary — we don't override.
    expect(opts.headers.get("Content-Type")).toBeNull();
  });
});
