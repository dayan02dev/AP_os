// Seam: GET /admin/users returns `total` = exact matching-profile count while
// the page holds at most `limit` (default 200) rows (admin_users.list_users).
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../lib/api.js", () => ({
  api: {
    get: vi.fn(() => Promise.resolve({
      users: [
        { id: "u1", email: "a@x.io", full_name: "A", roles: ["applicant"], created_at: "2026-07-01T00:00:00Z" },
        { id: "u2", email: "b@x.io", full_name: "B", roles: ["reviewer"], created_at: "2026-07-02T00:00:00Z" },
      ],
      total: 1250,
    })),
  },
}));

import UserListPage from "../UserListPage.jsx";

describe("UserListPage ↔ /admin/users total", () => {
  it("says 'N of total' when the page holds fewer rows than total", async () => {
    render(<MemoryRouter><UserListPage /></MemoryRouter>);
    expect(await screen.findByText("2 of 1250")).toBeTruthy();
  });
});
