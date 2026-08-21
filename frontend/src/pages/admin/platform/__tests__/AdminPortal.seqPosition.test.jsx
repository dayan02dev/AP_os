// Spec §4.2: "Walking with Prev/Next advances the shared position, so returning
// lands on the application you stopped at, not the one you entered from."
//
// The detail view walks a sequence handed to it by whichever list opened it.
// When that list is the Gate-1 stack, the stack's remembered position has to
// follow the walk — otherwise Back drops you at your entry point and every step
// you took is thrown away. Walking the Applications list must NOT move it: that
// list is not the gate-1 queue and has nothing to say about where you were in it.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const app = (id, name) => ({
  id, name, track: "tir", domain: "Robotics", stage: "Prototype",
  founders: ["F"], sub: "2026-06-01", chip: "EVALUATED",
  ai: { overall: 7.5 }, flags: [], batch: "Batch A", status: "evaluated",
  hidden: false, archived: false,
});
const FIVE = [
  app("a1", "Alpha"), app("a2", "Bravo"), app("a3", "Charlie"),
  app("a4", "Delta"), app("a5", "Echo"),
];

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn((kind) => {
    if (kind === "stats") {
      return { data: { totals: {}, statusCounts: [] }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "batches") {
      return { data: { batches: [{ id: "b-1", name: "Batch A" }] }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "icDocuments") {
      return { data: { byKey: {} }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "pipeline") {
      return { data: { startups: FIVE, total: FIVE.length }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0, jurors: [], pendingInvites: [], reviewers: [], batches: [] },
      loading: false, error: null, reload: vi.fn() };
  }),
  loadDetail: vi.fn((track, id) => Promise.resolve({
    id, track: track || "tir", name: (FIVE.find(r => r.id === id) || {}).name || "?",
    domain: "Robotics", stage: "Prototype", founders: ["F"], sub: "2026-06-01",
    chip: "EVALUATED", ai: {}, reviews: [],
  })),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../screens/ComparativeReviewModel", () => ({
  ComparativeReviewModel: () => null,
}));
vi.mock("../screens/ApplicationSummaryCard", () => ({
  default: ({ onViewFullApplication }) => (
    onViewFullApplication
      ? <button onClick={onViewFullApplication}>View full application →</button>
      : null
  ),
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <div>Preview</div>,
}));

import AdminPortalDefault from "../AdminPortal";

// Tab labels collide with other page copy ("Applications" also appears in the
// list heading), so address the tab strip directly.
const clickTab = (label) => {
  const el = [...document.querySelectorAll(".lp-tab-label")]
    .find((n) => n.textContent.trim().startsWith(label));
  if (!el) throw new Error(`No tab labelled ${label}`);
  fireEvent.click(el);
};
const openGate1 = () => clickTab("Admin Review");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminPortal — Prev/Next moves the shared position", () => {
  it("returns you to the application you walked to, not the one you entered from", async () => {
    render(<AdminPortalDefault />);
    openGate1();
    expect(screen.getByText("1/5")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View full application →"));
    expect(await screen.findByText("← Back to applications")).toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();

    // Walk one forward inside the detail view.
    fireEvent.click(screen.getByText("Next →"));
    await waitFor(() => expect(screen.getByText("2 / 5")).toBeInTheDocument());

    // Back must land on Bravo — where the walk stopped.
    fireEvent.click(screen.getByText("← Back to applications"));
    await waitFor(() => expect(screen.getByText("2/5")).toBeInTheDocument());
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("walks backwards too", async () => {
    render(<AdminPortalDefault />);
    openGate1();
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("3/5")).toBeInTheDocument();

    fireEvent.click(screen.getByText("View full application →"));
    expect(await screen.findByText("← Back to applications")).toBeInTheDocument();
    fireEvent.click(screen.getByText("← Prev"));
    await waitFor(() => expect(screen.getByText("2 / 5")).toBeInTheDocument());

    fireEvent.click(screen.getByText("← Back to applications"));
    await waitFor(() => expect(screen.getByText("2/5")).toBeInTheDocument());
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("walking the Applications list leaves the Gate-1 position alone", async () => {
    render(<AdminPortalDefault />);

    // Park the gate-1 stack on Charlie.
    openGate1();
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("3/5")).toBeInTheDocument();

    // Now walk a completely different list.
    clickTab("Applications");
    fireEvent.click(screen.getByText("Alpha"));
    expect(await screen.findByText("← Back to applications")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next →"));
    await waitFor(() => expect(screen.getByText("2 / 5")).toBeInTheDocument());
    fireEvent.click(screen.getByText("← Back to applications"));

    // Gate 1 is still exactly where we left it.
    openGate1();
    await waitFor(() => expect(screen.getByText("3/5")).toBeInTheDocument());
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });
});
