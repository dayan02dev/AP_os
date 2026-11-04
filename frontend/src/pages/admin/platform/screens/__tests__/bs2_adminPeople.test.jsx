// BS2 g7 — admin people fixes (S2-ADM-16/17/31/62/64/65/66).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    patchReviewer: vi.fn().mockResolvedValue({}),
    assignBatchReviewers: vi.fn().mockResolvedValue({ created: 1 }),
    unassignBatchReviewer: vi.fn().mockResolvedValue({}),
    deleteReviewer: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("../../../../../lib/adminApi", () => ({
  adminApi: { createUser: vi.fn(), listUsers: vi.fn(), grantRole: vi.fn(), revokeRole: vi.fn() },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../../lib/adminPlatformApi";
import { adminApi } from "../../../../../lib/adminApi";
import { AdminReviewers } from "../AdminReviewers";
import { AdminRoles } from "../AdminRoles";

const rv = (id, name, weight = 1, batches = []) => ({
  id, name, email: `${id}@x.in`, weight, domains: [], domain: "",
  batch: "Unassigned", batches, assigned: 0, completed: 0, progress: "0 / 0", last: null,
});

function mockData({ reviewers, batches = [], reload = vi.fn() }) {
  useAdminData.mockImplementation((kind) => {
    if (kind === "batches") return { data: { batches }, loading: false, error: null, reload: vi.fn() };
    return { data: { reviewers }, loading: false, error: null, reload };
  });
  return reload;
}

beforeEach(() => {
  vi.clearAllMocks();
  try { sessionStorage.clear(); } catch { /* noop */ }
});

describe("AdminReviewers", () => {
  it("S2-ADM-17: invite result (credentials_emailed false, temp password) stays visible", async () => {
    const reload = mockData({ reviewers: [rv("r1", "Rev One")] });
    adminApi.createUser.mockResolvedValue({
      id: "new", temp_password: "Rv-Abc1!xyzQQ", existing_user: false, credentials_emailed: false,
    });
    render(<AdminReviewers />);
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Vikram Sundar"), { target: { value: "New Rev" } });
    fireEvent.change(screen.getByPlaceholderText("name@example.in"), { target: { value: "new@x.in" } });
    fireEvent.click(screen.getByRole("button", { name: "Send Invite" }));
    await screen.findByText(/Reviewer invited successfully/);
    expect(screen.getByText(/Rv-Abc1!xyzQQ/)).toBeTruthy();
    expect(screen.getByText(/credentials email could not be sent/)).toBeTruthy();
    expect(reload).toHaveBeenCalled();
  });

  it("S2-ADM-31: weight 0 sorts as lowest", () => {
    mockData({ reviewers: [rv("a", "Zero Weight", 0), rv("b", "Half Weight", 0.5)] });
    render(<AdminReviewers />);
    fireEvent.click(screen.getByText("Weight / Primary"));
    const rows = screen.getAllByRole("row").slice(1).map(r => r.textContent);
    expect(rows[0]).toMatch(/Zero Weight/);
  });

  it("S2-ADM-62: clearing the weight field does not save weight 0", async () => {
    mockData({ reviewers: [rv("a", "Rev A", 1.5)] });
    render(<AdminReviewers />);
    fireEvent.click(screen.getByRole("button", { name: "Edit reviewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByDisplayValue("1.5"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminPlatformApi.patchReviewer).toHaveBeenCalled());
    expect(adminPlatformApi.patchReviewer.mock.calls[0][1].weight).toBe(1.5);
  });

  it("S2-ADM-64: the computed 'Unbatched' bucket is not offered as a batch", () => {
    mockData({
      reviewers: [
        rv("r1", "Rev One", 1, [{ name: "Batch A", count: 1 }, { name: "Unbatched", count: 2 }]),
        rv("r2", "Rev Two", 1, [{ name: "Batch A", count: 0 }]),
      ],
      batches: [{ id: "b1", name: "Batch A" }, { id: "b2", name: "Batch B" }],
    });
    render(<AdminReviewers />);
    const sel = screen.getByLabelText("Assign a batch to Rev Two");
    expect(within(sel).getAllByRole("option").map(o => o.textContent)).toEqual(expect.not.arrayContaining(["Unbatched"]));
    expect(within(sel).getAllByRole("option").map(o => o.textContent)).toContain("Batch B");
  });
});

const u = (id, name, roles, created_at = "2026-01-10T00:00:00Z") =>
  ({ id, full_name: name, email: `${id}@x.in`, roles, created_at });

describe("AdminRoles", () => {
  it("S2-ADM-16: the shown temporary password is the one sent to the backend", async () => {
    adminApi.listUsers.mockResolvedValue({ users: [u("u1", "User 1", ["reviewer"])], total: 1 });
    adminApi.createUser.mockResolvedValue({ id: "n" });
    render(<AdminRoles />);
    await screen.findByText("User 1");
    fireEvent.click(screen.getByRole("button", { name: "+ Invite Member" }));
    const shown = screen.getByDisplayValue(/^Rv-/).value;
    fireEvent.change(screen.getByPlaceholderText("e.g. Vikram Sundar"), { target: { value: "Jury Person" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. vikram.s@artpark.in"), { target: { value: "j@x.in" } });
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Invite Member" }));
    await waitFor(() => expect(adminApi.createUser).toHaveBeenCalledTimes(1));
    const payload = adminApi.createUser.mock.calls[0][0];
    expect(payload.send_invite).toBe(false);
    expect(payload.temp_password).toBe(shown);
    expect(/[a-z]/.test(shown) && /[A-Z]/.test(shown) && /\d/.test(shown) && /[^A-Za-z0-9]/.test(shown)).toBe(true);
  });

  it("S2-ADM-66: 'Joined' sorts chronologically", async () => {
    adminApi.listUsers.mockResolvedValue({
      users: [u("b", "Newer Feb", [], "2026-02-05T00:00:00Z"), u("a", "Older Jan", [], "2026-01-10T00:00:00Z")],
      total: 2,
    });
    render(<AdminRoles />);
    await screen.findByText("Older Jan");
    fireEvent.click(screen.getByText("Joined"));
    const names = screen.getAllByRole("row").slice(1).map(r => r.textContent);
    expect(names[0]).toMatch(/Older Jan/);
  });

  it("S2-ADM-65: partial role-edit failure refetches and retries only the failed delta", async () => {
    adminApi.listUsers.mockResolvedValue({ users: [u("u1", "User 1", ["reviewer"])], total: 1 });
    adminApi.grantRole.mockResolvedValue({ ok: true });
    adminApi.revokeRole.mockRejectedValue(new Error("boom"));
    render(<AdminRoles />);
    await screen.findByText("User 1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await screen.findByText("boom");
    await waitFor(() => expect(adminApi.listUsers).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(adminApi.revokeRole).toHaveBeenCalledTimes(2));
    expect(adminApi.grantRole).toHaveBeenCalledTimes(1);
  });
});
