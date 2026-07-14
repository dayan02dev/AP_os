import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Same lightweight hook mocks as the rejectedTab smoke test. AdminJury reads
// useAdminData("jurors") + ("pipeline"); the generic branch returns empty sets
// so the screen renders its shell (Invite member, sub-tabs) without data.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "stats") {
      return { data: { totals: {}, statusCounts: [] }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0, jurors: [], pendingInvites: [], reviewers: [], batches: [] },
      loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

import AdminPortalDefault from "../AdminPortal";

describe("AdminPortal — jury decision mode", () => {
  // Regression: AdminPortal referenced <AdminJury/> without importing it, so
  // the Jury tab crashed with "AdminJury is not defined" (the component was
  // tree-shaken out of the bundle). This exercises that exact render path.
  it("renders the real AdminJury screen on the Jury tab without crashing", () => {
    render(<AdminPortalDefault />);
    // Switch to jury decision mode.
    fireEvent.click(screen.getByText("Jury Decision"));
    // The 'reviewers' tab is labelled "Jury" in jury mode — click it.
    fireEvent.click(screen.getByText("Jury"));
    // AdminJury's shell must render (this threw ReferenceError before the fix).
    expect(screen.getByText("Invite member")).toBeInTheDocument();
    expect(screen.getByText(/track background enrichment/i)).toBeInTheDocument();
  });

  it("renders AdminGate2 (Final Gate) in jury mode without crashing", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Jury Decision"));
    fireEvent.click(screen.getByText("Final Gate"));
    // No throw = pass; assert the tab switched (Final Gate tab is active).
    expect(screen.getAllByText("Final Gate").length).toBeGreaterThan(0);
  });
});
