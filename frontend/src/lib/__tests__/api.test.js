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

function pdfResponse(status, bytes = "%PDF-1.4 fake pdf bytes") {
  // A string body (not `new Blob([bytes])`) -- jsdom's fetch polyfill in
  // this test environment truncates a Blob-typed Response body when read
  // back via .blob(), which is an environment quirk unrelated to api.js;
  // a string body round-trips correctly and still exercises the same
  // Response.blob() code path in apiCall.
  return new Response(bytes, {
    status,
    headers: { "Content-Type": "application/pdf" },
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

  // ── blob path (binary responses, e.g. the MOU PDF preview) ───────────────
  describe("opts.blob — binary responses", () => {
    it("returns a Blob instead of parsed JSON when opts.blob is set", async () => {
      globalThis.fetch.mockResolvedValue(pdfResponse(200));
      const result = await apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
        method: "POST",
        body: { collaborators: [] },
        blob: true,
      });
      expect(result).toBeInstanceOf(Blob);
      // jsdom's Blob shim doesn't implement .text()/.arrayBuffer() — assert
      // on size/type instead, which is enough to prove the real response
      // body came through untouched rather than being JSON-parsed.
      expect(result.type).toBe("application/pdf");
      expect(result.size).toBe(new Blob(["%PDF-1.4 fake pdf bytes"]).size);
    });

    it("still JSON-serialises the request body and sets Content-Type", async () => {
      globalThis.fetch.mockResolvedValue(pdfResponse(200));
      await apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
        method: "POST",
        body: { collaborators: [{ name: "Aditi" }] },
        blob: true,
      });
      const [, opts] = globalThis.fetch.mock.calls[0];
      expect(typeof opts.body).toBe("string");
      expect(JSON.parse(opts.body)).toEqual({ collaborators: [{ name: "Aditi" }] });
      expect(opts.headers.get("Content-Type")).toBe("application/json");
    });

    it("still attaches the Authorization header, same as the JSON path", async () => {
      saveSession({ access_token: "access-1", refresh_token: "refresh-1" });
      globalThis.fetch.mockResolvedValue(pdfResponse(200));
      await apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
        method: "POST",
        body: { collaborators: [] },
        blob: true,
      });
      const [, opts] = globalThis.fetch.mock.calls[0];
      expect(opts.headers.get("Authorization")).toBe("Bearer access-1");
    });

    it("refreshes then retries once on 401, same as the JSON path", async () => {
      saveSession({ access_token: "stale", refresh_token: "refresh-1" });
      globalThis.fetch
        .mockResolvedValueOnce(jsonResponse(401, { error: { code: "expired" } }))
        .mockResolvedValueOnce(
          jsonResponse(200, { access_token: "fresh", refresh_token: "refresh-2" }),
        )
        .mockResolvedValueOnce(pdfResponse(200));

      const result = await apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
        method: "POST",
        body: { collaborators: [] },
        blob: true,
      });
      expect(result).toBeInstanceOf(Blob);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
      const retryHeaders = globalThis.fetch.mock.calls[2][1].headers;
      expect(retryHeaders.get("Authorization")).toBe("Bearer fresh");
    });

    it("throws ApiError with the backend's detail.code shape on a non-2xx blob request, same as the JSON path", async () => {
      globalThis.fetch.mockResolvedValue(
        jsonResponse(422, { detail: { code: "invalid_signature", message: "bad png" } }),
      );
      await expect(
        apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
          method: "POST",
          body: { collaborators: [] },
          blob: true,
        }),
      ).rejects.toMatchObject({
        name: "ApiError",
        status: 422,
        code: "invalid_signature",
        message: "bad png",
      });
    });

    it("applies the same timeout behaviour as the JSON path", async () => {
      vi.useFakeTimers();
      globalThis.fetch.mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      );
      const promise = apiCall("/founder/mou/preview/pdf?slug=facility-v1", {
        method: "POST",
        body: { collaborators: [] },
        blob: true,
        timeoutMs: 5000,
      });
      const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      vi.useRealTimers();
    });
  });
});
