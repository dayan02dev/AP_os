// Staff password self-service.
//
// Reviewers and jury members are onboarded with a temp password an admin can
// read, so two things have to hold: they can replace it themselves from any
// staff portal, and until they do, the portal pushes them to.
//
// Covered here: the form's validation gate + the exact call it makes; the
// settings entry point in the Reviewer/Jury topbars; and needsPasswordSetup,
// which is what the router gate and the sign-in redirect both key off.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setPassword = vi.fn();
let currentUser = { email: "reviewer@artpark.in", roles: ["reviewer"], password_set: false };

vi.mock("../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: currentUser, setPassword }),
}));

import ChangePasswordForm from "../ChangePasswordForm.jsx";
import AccountSettingsButton from "../AccountSettingsButton.jsx";
import { needsPasswordSetup } from "../../lib/landing.js";

const STRONG = "Str0ng!Pass";

beforeEach(() => {
  vi.clearAllMocks();
  setPassword.mockResolvedValue(undefined);
  currentUser = { email: "reviewer@artpark.in", roles: ["reviewer"], password_set: false };
});

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ChangePasswordForm", () => {
  it("keeps submit disabled until the password is strong AND confirmed", () => {
    render(<ChangePasswordForm />);
    const submit = screen.getByRole("button", { name: /Update password/ });
    expect(submit.disabled).toBe(true);

    type("New password", "weak");
    expect(submit.disabled).toBe(true);

    type("New password", STRONG);
    expect(submit.disabled).toBe(true);          // not confirmed yet

    type("Confirm new password", "Str0ng!Pas");  // mismatch
    expect(submit.disabled).toBe(true);

    type("Confirm new password", STRONG);
    expect(submit.disabled).toBe(false);
  });

  it("saves through useAuth().setPassword, which posts to /auth/set-password", async () => {
    render(<ChangePasswordForm />);
    type("New password", STRONG);
    type("Confirm new password", STRONG);
    fireEvent.click(screen.getByRole("button", { name: /Update password/ }));

    await waitFor(() => expect(setPassword).toHaveBeenCalledWith(STRONG));
    await waitFor(() => expect(screen.getByText(/Password updated/)).toBeTruthy());
  });

  it("clears the fields after a successful save so the new password isn't left on screen", async () => {
    render(<ChangePasswordForm />);
    type("New password", STRONG);
    type("Confirm new password", STRONG);
    fireEvent.click(screen.getByRole("button", { name: /Update password/ }));
    await waitFor(() => expect(screen.getByLabelText("New password").value).toBe(""));
    expect(screen.getByLabelText("Confirm new password").value).toBe("");
  });

  it("surfaces a weak-password rejection from Supabase (422)", async () => {
    setPassword.mockRejectedValue({ status: 422, message: "Password doesn't meet the strength requirements." });
    render(<ChangePasswordForm />);
    type("New password", STRONG);
    type("Confirm new password", STRONG);
    fireEvent.click(screen.getByRole("button", { name: /Update password/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/strength requirements/));
  });

  it("surfaces the rate limit (429) rather than looking like a silent no-op", async () => {
    setPassword.mockRejectedValue({ status: 429 });
    render(<ChangePasswordForm />);
    type("New password", STRONG);
    type("Confirm new password", STRONG);
    fireEvent.click(screen.getByRole("button", { name: /Update password/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Too many password changes/));
  });

  it("shows a live checklist so the rules aren't a guessing game", () => {
    render(<ChangePasswordForm />);
    type("New password", STRONG);
    expect(screen.getByText(/✓ At least 8 characters/)).toBeTruthy();
    expect(screen.getByText(/✓ One uppercase letter/)).toBeTruthy();
    expect(screen.getByText(/✓ One number/)).toBeTruthy();
    expect(screen.getByText(/✓ One special character/)).toBeTruthy();
  });
});

describe("AccountSettingsButton (Reviewer / Jury topbars)", () => {
  it("opens a Settings modal containing the change-password form", () => {
    render(<AccountSettingsButton />);
    expect(screen.queryByLabelText("New password")).toBeNull();

    fireEvent.click(screen.getByLabelText("Settings"));
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.getByText("Change password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
  });

  it("closes again without saving anything", () => {
    render(<AccountSettingsButton />);
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Close settings"));
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(setPassword).not.toHaveBeenCalled();
  });
});

describe("needsPasswordSetup", () => {
  it("is true only for an explicit password_set:false (still on the temp password)", () => {
    expect(needsPasswordSetup({ password_set: false })).toBe(true);
  });

  it("is false once the user has chosen their own password", () => {
    expect(needsPasswordSetup({ password_set: true })).toBe(false);
  });

  it("never locks anyone out when the flag is absent or the user is unresolved", () => {
    // A degraded /auth/me payload must not strand a reviewer outside their
    // portal — fail OPEN here; the backend is still the authority.
    expect(needsPasswordSetup({})).toBe(false);
    expect(needsPasswordSetup(null)).toBe(false);
    expect(needsPasswordSetup(undefined)).toBe(false);
  });
});
