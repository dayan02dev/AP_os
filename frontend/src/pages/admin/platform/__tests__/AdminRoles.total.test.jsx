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

describe("AdminRoles role tiles", () => {
  it("count every account per role from the backend, incl. an Applicants tile", async () => {
    adminApi.listUsers.mockResolvedValue({
      users: [user(1), { ...user(2), roles: ["applicant"] }], total: 1250,
      role_counts: { applicant: 1237, reviewer: 6, leadership: 5, jury: 1, admin: 3 },
    });
    render(<AdminRoles />);
    await screen.findByText("User 1");
    expect(screen.getByTestId("roles-kpi-reviewer").textContent).toMatch(/6/);
    expect(screen.getByTestId("roles-kpi-leadership").textContent).toMatch(/5/);
    expect(screen.getByTestId("roles-kpi-jury").textContent).toMatch(/1/);
    const app = screen.getByTestId("roles-kpi-applicant");
    expect(app.textContent).toMatch(/Applicants/i);
    expect(app.textContent).toMatch(/1237/);
    expect(screen.queryByText(/on this page/)).toBeNull();
  });
  it("page-scoped fallback counts applicants on an older backend", async () => {
    adminApi.listUsers.mockResolvedValue({
      users: [user(1), { ...user(2), roles: ["applicant"] }, { ...user(3), roles: ["applicant"] }],
      total: 1250,
    });
    render(<AdminRoles />);
    await screen.findByText("User 1");
    expect(screen.getByTestId("roles-kpi-applicant").textContent).toMatch(/2/);
    expect(screen.getAllByText(/on this page/).length).toBeGreaterThan(0);
  });
  it("no stale 'Preview — backend pending' badge", async () => {
    adminApi.listUsers.mockResolvedValue({ users: [user(1)], total: 1 });
    render(<AdminRoles />);
    await screen.findByText("User 1");
    expect(screen.queryByText(/backend pending/i)).toBeNull();
  });
});
