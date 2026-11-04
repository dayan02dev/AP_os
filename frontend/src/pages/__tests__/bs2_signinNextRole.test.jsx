// SWARM2 auth_shared: ?next= is honoured for staff surfaces without checking
// that the signing-in account can open that surface. Leadership's own
// "Sign out" (LeadershipDashboard.jsx:679, onClick={logout} with no navigate)
// leaves the tab on /apply/signin?next=%2Fleadership, so the NEXT person who
// signs in on that machine (e.g. a reviewer) is sent to /leadership and gets
// "Access denied — leadership role required" instead of their own portal.
// These tests assert the CORRECT behaviour and fail on the bug.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

let rolesForSignIn = ["reviewer"];
vi.mock("../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({
    requestOtp: vi.fn(),
    signInWithPassword: vi.fn(async () => ({ email: "r@artpark.in", roles: rolesForSignIn })),
  }),
}));
vi.mock("../../hooks/useToast.jsx", () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock("../../hooks/usePageTheme.jsx", () => ({ usePageTheme: () => {} }));
vi.mock("../../lib/founderApi.js", () => ({ founderApi: { me: vi.fn(async () => { throw new Error("403"); }) } }));

import SignInPage from "../../pages/SignInPage.jsx";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

async function signInAt(url) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/apply/signin" element={<SignInPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: "r@artpark.in" } });
  fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: "pw" } });
  fireEvent.submit(document.querySelector("form"));
  return waitFor(() => screen.getByTestId("where"));
}

beforeEach(() => { rolesForSignIn = ["reviewer"]; });

describe("sign-in ?next= must respect the signing-in account's role", () => {
  it("reviewer signing in after a leadership sign-out lands on /reviewer, not /leadership", async () => {
    await signInAt("/apply/signin?next=%2Fleadership");
    expect(screen.getByTestId("where").textContent).toBe("/reviewer");
  });

  it("leadership-only account with a stale next=/reviewer/queue lands on /leadership", async () => {
    rolesForSignIn = ["leadership"];
    await signInAt("/apply/signin?next=%2Freviewer%2Fqueue");
    expect(screen.getByTestId("where").textContent).toBe("/leadership");
  });
});
