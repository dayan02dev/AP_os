// ADM-23 — TOTAL USERS is the backend's exact total (contract C4), with paging.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/adminApi", () => ({
  adminApi: { listUsers: vi.fn(), createUser: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn() },
}));
import { adminApi } from "../../../../lib/adminApi";
import { AdminRoles } from "../screens/AdminRoles";

const user = (i) => ({ id: `u${i}`, full_name: `User ${i}`, email: `u${i}@x.in`, roles: ["reviewer"], created_at: "2026-01-10T00:00:00Z" });

describe("AdminRoles total + paging", () => {
  it("shows the exact total and pages with limit/offset", async () => {
    adminApi.listUsers.mockImplementation(({ offset = 0 } = {}) =>
      Promise.resolve({ users: [user(offset + 1), user(offset + 2)], total: 1250 }));
    render(<AdminRoles />);
    await screen.findByText("User 1");
    expect(screen.getByTestId("roles-kpi-total").textContent).toMatch(/1250/);
    expect(screen.getByText(/Showing 1–2 of 1250/)).toBeTruthy();
    expect(adminApi.listUsers).toHaveBeenCalledWith(expect.objectContaining({ limit: 200, offset: 0 }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    await waitFor(() =>
      expect(adminApi.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 200 })));
    await screen.findByText("User 201");
  });

  it("falls back to the row count on an older backend (no total)", async () => {
    adminApi.listUsers.mockResolvedValue({ users: [user(1), user(2)] });
    render(<AdminRoles />);
    await screen.findByText("User 1");
    expect(screen.getByTestId("roles-kpi-total").textContent).toMatch(/2/);
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  });
});
