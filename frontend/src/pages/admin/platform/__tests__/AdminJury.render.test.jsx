import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// AdminJury is no longer reachable by clicking — its tab was removed when the
// portal collapsed to a single decision mode. It stays on disk for next
// cohort, so it keeps a direct-render test: without one, nothing would catch a
// missing import or a crash-on-mount until the tab is restored.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: () => ({
    data: { startups: [], total: 0, jurors: [], pendingInvites: [], reviewers: [], batches: [] },
    loading: false, error: null, reload: vi.fn(),
  }),
  loadDetail: vi.fn(),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminJury } from "../screens/AdminJury";

describe("AdminJury — kept for next cohort", () => {
  it("mounts without crashing", () => {
    render(<AdminJury />);
    expect(screen.getByText("Invite member")).toBeInTheDocument();
  });
});
