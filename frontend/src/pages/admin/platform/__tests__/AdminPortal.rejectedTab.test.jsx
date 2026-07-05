import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "stats") {
      return { data: { totals: { apps_submitted: 100 },
        statusCounts: [{ id: "rejected", n: 12 }, { id: "evaluated", n: 4 }] },
        loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0, reviewers: [], batches: [] },
      loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

// AdminTopbar (rendered on every page) calls useAuth() for the signed-in user
// + PortalSwitcher also calls useAuth()/useNavigate(). Neither a Router nor an
// AuthProvider is mounted around this render, so both are mocked directly —
// same treatment as useAdminData above — rather than pulling in real auth
// rehydration / router context for what is otherwise a pure tab-bar smoke test.
vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

import AdminPortalDefault from "../AdminPortal";

describe("AdminPortal — Rejected Applications tab", () => {
  it("renders the 5th tab with the rejected count and a reduced Applications count", () => {
    render(<AdminPortalDefault />);
    expect(screen.getByText("Rejected Applications")).toBeTruthy();
    expect(screen.getByText("88")).toBeTruthy();  // apps badge = 100 - 12
    expect(screen.getByText("12")).toBeTruthy();  // rejected badge
  });
});
