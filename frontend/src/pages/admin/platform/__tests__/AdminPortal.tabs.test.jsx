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

describe("AdminPortal — single-mode tab strip", () => {
  it("has no decision-mode toggle", () => {
    render(<AdminPortalDefault />);
    expect(screen.queryByText("Jury Decision")).toBeNull();
    expect(screen.queryByText("Reviewer Decision")).toBeNull();
  });

  // Final Gate (AdminGate2) is disabled this round — no jury; final
  // accept/reject happens on the Accepted tab. Its tab must be gone.
  it("does not offer the Final Gate tab", () => {
    render(<AdminPortalDefault />);
    expect(screen.queryByText("Final Gate")).toBeNull();
    expect(screen.queryByText("B · History")).toBeNull();
  });

  it("renders the Selected Applications screen without crashing", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByText("No selected applications yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Search selected applications")).toBeInTheDocument();
  });

  it("offers ONE selected tab covering both tracks, not a tab per track", () => {
    render(<AdminPortalDefault />);
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.queryByText("TIR Selected")).toBeNull();
    expect(screen.queryByText("VIP Selected")).toBeNull();
  });

  it("offers the track switcher there so a single track can still be isolated", () => {
    render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Accepted"));
    expect(screen.getByRole("button", { name: "TIR" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "VIP" })).toBeInTheDocument();
  });
});
