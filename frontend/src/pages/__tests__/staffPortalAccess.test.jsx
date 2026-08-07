// Staff portals must NOT force a password change.
//
// A reviewer/juror signing in with the password they already have goes
// straight to their portal. Choosing a new one is OPT-IN, from the Settings
// gear in the topbar (Reviewer/Jury) or the Admin Settings modal — see
// components/__tests__/ChangePasswordForm.test.jsx.
//
// This file exists to stop a forced-redirect gate being reintroduced: an
// earlier build bounced anyone whose `password_set` was false to
// /apply/set-password on login, which interrupted people who were signing in
// perfectly well with their existing password.

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

vi.mock("../ProtectedRoute.jsx", () => ({ default: ({ children }) => children }));

vi.mock("../reviewer/v2/ReviewerPortal.jsx", () => ({ default: () => <div>REVIEWER PORTAL</div> }));
vi.mock("../jury/JuryPortal.jsx", () => ({ default: () => <div>JURY PORTAL</div> }));
vi.mock("../admin/platform/AdminPortal.jsx", () => ({ default: () => <div>ADMIN PORTAL</div> }));
vi.mock("../leadership/LeadershipDashboard.jsx", () => ({ default: () => <div>LEADERSHIP DASHBOARD</div> }));
vi.mock("../SetPasswordPage.jsx", () => ({ default: () => <div>SET PASSWORD SCREEN</div> }));

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

describe("staff portals — password state never blocks access", () => {
  it.each(CASES)("%s opens even when password_set is false", (path, roles, marker) => {
    // password_set:false only means "hasn't chosen their own password yet".
    // That is not a reason to interrupt someone who just signed in fine.
    currentUser = { email: "x@artpark.in", roles, password_set: false };
    renderAt(path);
    expect(screen.getByText(marker)).toBeTruthy();
    expect(screen.queryByText("SET PASSWORD SCREEN")).toBeNull();
  });

  it.each(CASES)("%s opens when password_set is true", (path, roles, marker) => {
    currentUser = { email: "x@artpark.in", roles, password_set: true };
    renderAt(path);
    expect(screen.getByText(marker)).toBeTruthy();
  });

  it.each(CASES)("%s opens when the flag is absent entirely", (path, roles, marker) => {
    currentUser = { email: "x@artpark.in", roles };
    renderAt(path);
    expect(screen.getByText(marker)).toBeTruthy();
  });

  it("does not interrupt a deep link into the reviewer eval screen", () => {
    currentUser = { email: "r@artpark.in", roles: ["reviewer"], password_set: false };
    renderAt("/reviewer/eval/tir/app-1");
    expect(screen.getByText("REVIEWER PORTAL")).toBeTruthy();
  });

  it("does not interrupt a deep link into the jury picks screen", () => {
    currentUser = { email: "j@artpark.in", roles: ["jury"], password_set: false };
    renderAt("/jury/picks");
    expect(screen.getByText("JURY PORTAL")).toBeTruthy();
  });

  it("still refuses a wrong-role account (the capability check is unaffected)", () => {
    currentUser = { email: "a@x.com", roles: ["applicant"], password_set: false };
    renderAt("/admin");
    expect(screen.getByText(/Access denied/i)).toBeTruthy();
  });

  it("keeps /apply/set-password reachable on purpose", () => {
    // The screen isn't gone — it still backs the applicant OTP / forgot-password
    // flow, and anyone who navigates there deliberately.
    currentUser = { email: "r@artpark.in", roles: ["reviewer"], password_set: false };
    renderAt("/apply/set-password");
    expect(screen.getByText("SET PASSWORD SCREEN")).toBeTruthy();
  });
});
