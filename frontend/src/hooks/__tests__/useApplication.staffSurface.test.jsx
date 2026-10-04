// ADM-22 — the staff portals (admin / leadership / reviewer / jury) must not
// call the applicant endpoints: /applications/me 403s for staff (and would
// auto-create a draft for them while intake is open).
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationProvider } from "../useApplication.jsx";
import { AuthProvider } from "../useAuth.jsx";
import { _resetSessionForTests, saveSession } from "../../lib/session.js";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ApplicationProvider on staff surfaces", () => {
  beforeEach(() => {
    _resetSessionForTests();
    saveSession({ access_token: "a", refresh_token: "r" });
    vi.stubGlobal("fetch", vi.fn((url) =>
      Promise.resolve(String(url).includes("/auth/me")
        ? json(200, { id: "u1", email: "staff@x.com", roles: ["admin"] })
        : json(200, []))));
  });
  afterEach(() => vi.unstubAllGlobals());

  const appCalls = () => globalThis.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("/applications/me"));

  it.each(["/admin", "/leadership", "/reviewer/queue", "/jury"])("does not load the applicant draft on %s", async (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider><ApplicationProvider><div /></ApplicationProvider></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(appCalls()).toEqual([]);
  });

  it("still loads on the applicant wizard", async () => {
    render(
      <MemoryRouter initialEntries={["/apply"]}>
        <AuthProvider><ApplicationProvider><div /></ApplicationProvider></AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(appCalls().length).toBeGreaterThan(0));
  });
});
