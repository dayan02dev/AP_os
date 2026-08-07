// Forced first-login password change for staff portals.
//
// A reviewer or juror signs in with a temp password we emailed them. Until
// they replace it, every staff surface must bounce to /apply/set-password —
// including a deep link and an already-open session, not just the sign-in
// path. This drives the real route tree so the gate can't be bypassed by
// entering a portal from an angle nobody wired.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let currentUser = null;

vi.mock("../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({
    user: currentUser,
    isAuthed: !!currentUser,
    loading: false,
    setPassword: vi.fn(),
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }) => children,
}));

// ProtectedRoute has its own session plumbing; auth is already covered by the
// mock above, so let it through and keep this test about the password gate.
vi.mock("../ProtectedRoute.jsx", () => ({
  default: ({ children }) => children,
}));

// Portals are heavy (data hooks, CSS, canvas). Stub each to a marker so a
// render tells us purely whether the gate let it through.
vi.mock("../reviewer/v2/ReviewerPortal.jsx", () => ({
  default: () => <div>REVIEWER PORTAL</div>,
}));
vi.mock("../jury/JuryPortal.jsx", () => ({
  default: () => <div>JURY PORTAL</div>,
}));
vi.mock("../admin/platform/AdminPortal.jsx", () => ({
  default: () => <div>ADMIN PORTAL</div>,
}));
vi.mock("../leadership/LeadershipDashboard.jsx", () => ({
  default: () => <div>LEADERSHIP DASHBOARD</div>,
}));
vi.mock("../SetPasswordPage.jsx", () => ({
  default: () => <div>SET PASSWORD SCREEN</div>,
}));

import AppRoutes from "../../router.jsx";

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

beforeEach(() => { currentUser = null; });

const CASES = [
  ["/reviewer", ["reviewer"], "REVIEWER PORTAL"],
  ["/jury", ["jury"], "JURY PORTAL"],
  ["/admin", ["admin"], "ADMIN PORTAL"],
  ["/leadership", ["leadership"], "LEADERSHIP DASHBOARD"],
];

describe("staff portals — forced password setup", () => {
  it.each(CASES)("%s redirects to set-password while on the issued temp password", (path, roles) => {
    currentUser = { email: "x@artpark.in", roles, password_set: false };
    renderAt(path);
    expect(screen.getByText("SET PASSWORD SCREEN")).toBeTruthy();
  });

  it.each(CASES)("%s opens normally once a password has been set", (path, roles, marker) => {
    currentUser = { email: "x@artpark.in", roles, password_set: true };
    renderAt(path);
    expect(screen.getByText(marker)).toBeTruthy();
  });

  it("catches a deep link into the reviewer eval screen too", () => {
    currentUser = { email: "r@artpark.in", roles: ["reviewer"], password_set: false };
    renderAt("/reviewer/eval/tir/app-1");
    expect(screen.getByText("SET PASSWORD SCREEN")).toBeTruthy();
  });

  it("catches a deep link into the jury picks screen too", () => {
    currentUser = { email: "j@artpark.in", roles: ["jury"], password_set: false };
    renderAt("/jury/picks");
    expect(screen.getByText("SET PASSWORD SCREEN")).toBeTruthy();
  });

  it("does not lock out an account whose /auth/me omits the flag", () => {
    // Fail OPEN on a degraded payload — a missing field must never cost a
    // reviewer access to their queue.
    currentUser = { email: "r@artpark.in", roles: ["reviewer"] };
    renderAt("/reviewer");
    expect(screen.getByText("REVIEWER PORTAL")).toBeTruthy();
  });

  it("still shows access-denied (not the password screen) for a wrong-role account", () => {
    // The capability check stays outermost: an applicant poking at /admin gets
    // the same refusal it always got, regardless of their password state.
    currentUser = { email: "a@x.com", roles: ["applicant"], password_set: false };
    renderAt("/admin");
    expect(screen.getByText(/Access denied/i)).toBeTruthy();
    expect(screen.queryByText("SET PASSWORD SCREEN")).toBeNull();
  });
});
