import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SipApplicationProvider, useSipApplication } from "../useSipApplication.jsx";
import { AuthProvider } from "../useAuth.jsx";
import { _resetSessionForTests, saveSession } from "../../lib/session.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function Harness({ onReady }) { const app = useSipApplication(); onReady(app); return null; }

describe("useSipApplication intake-closed", () => {
  beforeEach(() => { _resetSessionForTests(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("loads submitted apps and sets sipClosed when the draft fetch is intake-closed", async () => {
    saveSession({ access_token: "a", refresh_token: "r" });
    const captured = {};
    const past = [{ id: "app-1", status: "under_review", submitted_at: "2026-06-15T00:00:00Z" }];
    globalThis.fetch
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { id: "u1", email: "u@x.com" }))) // /auth/me
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, past)))                            // /sip-applications/me/submitted (fetched first)
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(403, { detail: { code: "sip_submissions_closed", message: "VIP intake closed" } }))); // /sip-applications/me
    render(
      <AuthProvider>
        <SipApplicationProvider>
          <Harness onReady={(a) => { captured.app = a; }} />
        </SipApplicationProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(captured.app?.sipClosed).toBe(true));
    expect(captured.app.submittedApps).toHaveLength(1);
    expect(captured.app.submittedApps[0].id).toBe("app-1");
  });
});
