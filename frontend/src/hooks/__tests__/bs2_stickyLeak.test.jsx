// SWARM2 auth_shared: sticky portal filters (useStickyState, sessionStorage)
// are wiped ONLY by the explicit Sign-out button (useAuth.signOut). When the
// session ends any other way — refresh failure / 401-retry → clearSession()
// → 'auth:expired' — the filters survive in the tab, and the next person who
// signs in on that tab inherits the previous user's filtered queue/pipeline.
// Asserts the CORRECT behaviour (a fresh sign-in starts clean) — fails on bug.
import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

vi.mock("../../lib/auth.js", () => ({
  getMe: vi.fn(async () => ({ id: "user-b", email: "b@artpark.in", roles: ["reviewer"] })),
  signInWithPassword: vi.fn(async () => ({})),
  logout: vi.fn(async () => {}),
  verifyOtp: vi.fn(async () => ({})),
  requestOtp: vi.fn(async () => ({})),
  setPassword: vi.fn(async () => ({})),
}));

import { AuthProvider, useAuth } from "../../hooks/useAuth.jsx";
import { writeStickyState, readStickyState } from "../../hooks/useStickyState.js";
import { saveSession, clearSession, _resetSessionForTests } from "../../lib/session.js";

let ctx = null;
function Grab() {
  const a = useAuth();
  useEffect(() => { ctx = a; });
  return null;
}

describe("sticky filters must not leak to the next user after a session expiry", () => {
  it("user A's queue filter is gone when user B signs in after A's session expired", async () => {
    _resetSessionForTests();
    // User A is signed in and filters their reviewer queue.
    saveSession({ access_token: "a1", refresh_token: "r1" });
    render(<AuthProvider><Grab /></AuthProvider>);
    await waitFor(() => expect(ctx?.loading).toBe(false));
    writeStickyState("reviewer.queue", "status", "submitted");
    // A's session dies (failed refresh path in api.js calls clearSession()).
    act(() => { clearSession(); });
    // User B signs in on the same tab.
    await act(async () => { await ctx.signInWithPassword("b@artpark.in", "pw"); });
    expect(readStickyState("reviewer.queue", "status", "all")).toBe("all");
  });
});
