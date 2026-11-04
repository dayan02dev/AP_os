// S2-SH-09: activity in another tab (shared heartbeat) keeps an idle tab signed in.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const logout = vi.fn();
vi.mock("../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ isAuthed: true, logout }) }));
import IdleLogout from "../IdleLogout.jsx";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  vi.useFakeTimers();
  logout.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("IdleLogout", () => {
  it("signs out when truly idle", () => {
    render(<MemoryRouter><IdleLogout /></MemoryRouter>);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 61_000);
    expect(logout).toHaveBeenCalled();
  });
  it("does not sign out when another tab was active recently", () => {
    render(<MemoryRouter><IdleLogout /></MemoryRouter>);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 120_000);
    localStorage.setItem("apos.lastActivity", String(Date.now())); // active in another tab
    vi.advanceTimersByTime(180_000);
    expect(logout).not.toHaveBeenCalled();
  });
});
