import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../api.js", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn(), put: vi.fn() },
  UPLOAD_TIMEOUT_MS: 60_000,
}));
import { api, UPLOAD_TIMEOUT_MS } from "../api.js";
import { founderApi } from "../founderApi.js";

describe("founderApi — AIR (VIP TLR evaluation)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // F6: the backend allows uploads up to 25 MB (26,214,400 bytes); the
  // default 30s timeout api.js gives every other call is too tight for
  // that on a slow connection. The one existing upload path in this
  // codebase (api.uploadSipTemplate) already passes UPLOAD_TIMEOUT_MS
  // (60s) explicitly — follow that precedent here too.
  it("F6: uploadAirEvidence posts with UPLOAD_TIMEOUT_MS, not the 30s default", () => {
    const file = new File(["x"], "evidence.pdf", { type: "application/pdf" });
    founderApi.uploadAirEvidence("architecture", 2, file);

    expect(api.post).toHaveBeenCalledTimes(1);
    const [path, body, opts] = api.post.mock.calls[0];
    expect(path).toBe("/founder/air/evidence");
    expect(body).toBeInstanceOf(FormData);
    expect(opts).toMatchObject({ timeoutMs: UPLOAD_TIMEOUT_MS });
  });

  it("getAir → /founder/air", () => {
    founderApi.getAir();
    expect(api.get).toHaveBeenCalledWith("/founder/air");
  });

  it("putAirLever → PUT /founder/air/levers/:lever with the payload", () => {
    const payload = { q1_option: "B", q2_option: null, q3_option: null, criteria_checked: [] };
    founderApi.putAirLever("architecture", payload);
    expect(api.put).toHaveBeenCalledWith("/founder/air/levers/architecture", payload);
  });

  it("delAirEvidence → DELETE /founder/air/evidence/:id", () => {
    founderApi.delAirEvidence("ev-1");
    expect(api.del).toHaveBeenCalledWith("/founder/air/evidence/ev-1");
  });
});
