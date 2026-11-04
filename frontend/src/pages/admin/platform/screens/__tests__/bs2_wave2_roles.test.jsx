// BS2 wave2 — AdminRoles invite result shows what the backend applied.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../lib/adminApi", () => ({
  adminApi: { createUser: vi.fn(), listUsers: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn() },
}));
import { adminApi } from "../../../../../lib/adminApi";
import { AdminRoles } from "../AdminRoles";

beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* noop */ }
  adminApi.listUsers.mockResolvedValue({ users: [], total: 0 });
});

async function invite(resp) {
  adminApi.createUser.mockResolvedValue(resp);
  render(<AdminRoles />);
  await waitFor(() => expect(adminApi.listUsers).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "+ Invite Member" }));
  fireEvent.change(screen.getByPlaceholderText("e.g. Vikram Sundar"), { target: { value: "Rev P" } });
  fireEvent.change(screen.getByPlaceholderText("e.g. vikram.s@artpark.in"), { target: { value: "r@x.in" } });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: "Invite Member" }));
  await waitFor(() => expect(adminApi.createUser).toHaveBeenCalled());
}

describe("AdminRoles invite result", () => {
  it("shows the password the backend applied and the existing-account note", async () => {
    await invite({ id: "x", temp_password: "Backend-Pw1!", existing_user: true, credentials_emailed: false });
    await screen.findByText(/Invite sent|Member invited/);
    expect(screen.getByText(/Backend-Pw1!/)).toBeTruthy();
    expect(screen.getByText(/Existing account/)).toBeTruthy();
  });

  it("existing staff account (no temp_password) says the password is unchanged", async () => {
    await invite({ id: "x", temp_password: null, existing_user: true });
    await screen.findByText(/Existing account/);
    expect(screen.getByText(/current password/)).toBeTruthy();
    expect(screen.queryByText(/Temp password/)).toBeNull();
  });
});

import { matchDisplayIdQuery } from "../../helpers/adminHelpers";
describe("display-ID search prefix (S2-SH-13)", () => {
  it("respects a typed prefix; vip == sip; bare digits match any track", () => {
    expect(matchDisplayIdQuery("TIR-26255", "VIP-26255")).toBe(false);
    expect(matchDisplayIdQuery("VIP-26255", "vip-26255")).toBe(true);
    expect(matchDisplayIdQuery("VIP-26255", "sip-26255")).toBe(true);
    expect(matchDisplayIdQuery("TIR-26255", "tir26255")).toBe(true);
    expect(matchDisplayIdQuery("TIR-26255", "26255")).toBe(true);
    expect(matchDisplayIdQuery("TIR-26255", "acme")).toBe(null);
  });
});
