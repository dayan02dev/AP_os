// Sticky filters are per-tab, and staff share machines — signing out must not
// leave the next person looking at the previous user's filtered view.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../lib/auth.js", () => ({
  logout: vi.fn().mockResolvedValue(undefined),
  getMe: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../lib/session.js", () => ({ loadSession: () => null }));

import { AuthProvider, useAuth } from "../useAuth.jsx";
import { STICKY_PREFIX } from "../useStickyState.js";

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

beforeEach(() => { vi.clearAllMocks(); });

describe("sign-out clears sticky filters", () => {
  it("drops persisted filters but leaves unrelated session storage alone", async () => {
    sessionStorage.setItem(`${STICKY_PREFIX}admin.pipeline.applications.track`, '"tir"');
    sessionStorage.setItem("unrelated.key", "keep-me");

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await result.current.logout(); });

    expect(sessionStorage.getItem(`${STICKY_PREFIX}admin.pipeline.applications.track`)).toBeNull();
    expect(sessionStorage.getItem("unrelated.key")).toBe("keep-me");
  });
});
