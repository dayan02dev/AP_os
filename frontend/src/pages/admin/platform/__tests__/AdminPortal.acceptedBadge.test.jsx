import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The Accepted badge counts SELECTED (green) applications: status jury_review
// with every current IC memo signed — /stats `pipeline_breakdown.stages
// .final_selected`, the same rule as the tab. The badge reads it from the
// portal-level /stats fetch only, so it can't be lost when a tab switch leaves
// the (much slower) jury_review pipeline / IC-document fetches unfinished.
const state = vi.hoisted(() => ({ docsLoading: false, statsLoading: false, final_selected: 2 }));

const JURY_REVIEW = [
  // signed → counts
  { id: "a", track: "tir", nativeTrack: "tir", name: "A" },
  // signed, moved TIR→VIP: the doc is keyed by the NATIVE track → counts
  { id: "b", track: "sip", nativeTrack: "tir", name: "B" },
  // memo uploaded but not signed → does not count
  { id: "c", track: "sip", nativeTrack: "sip", name: "C" },
  // no memo → does not count
  { id: "d", track: "tir", nativeTrack: "tir", name: "D" },
];
const DOCS = [
  { track: "tir", application_id: "a", signed: true },
  { track: "tir", application_id: "b", signed: true },
  { track: "sip", application_id: "c", signed: false },
  // signed memo for an app no longer in jury_review (rejected) → ignored
  { track: "tir", application_id: "zz", signed: true },
];

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => {
    if (kind === "stats") {
      if (state.statsLoading) return { data: null, loading: true, error: null, reload: vi.fn() };
      // Overlay-shaped: jury_review apps with a shortlist decision sit in
      // `accepted`, which is why the old jury_review badge read 0.
      return { data: { totals: { apps_submitted: 100 }, statusCounts: [
        { id: "rejected", n: 10 }, { id: "jury_review", n: 0 }, { id: "accepted", n: 4 },
      ], pipelineBreakdown: { total: 100, stages: {
        final_selected: state.final_selected, final_pending: 4 - state.final_selected,
      } } }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "icDocuments") {
      return state.docsLoading
        ? { data: null, loading: true, error: null, reload: vi.fn() }
        : { data: { documents: DOCS, byKey: {} }, loading: false, error: null, reload: vi.fn() };
    }
    if (kind === "pipeline" && params?.status === "jury_review") {
      return { data: { startups: JURY_REVIEW, total: 4 }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0, reviewers: [], batches: [] },
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

// A stand-in dashboard that navigates to a stale page id, the way a bookmarked
// or remembered 'gate2' would arrive.
vi.mock("../screens/AdminDashboard", () => ({
  AdminDashboard: ({ go }) => <button onClick={() => go("gate2")}>go-gate2</button>,
}));

import AdminPortalDefault from "../AdminPortal";

const tabBadge = (container, label) => {
  const tab = [...container.querySelectorAll(".lp-tab")]
    .find((t) => t.querySelector(".lp-tab-label")?.firstChild?.textContent === label);
  return tab?.querySelector(".lp-tab-badge")?.textContent ?? null;
};

describe("AdminPortal — Accepted badge", () => {
  beforeEach(() => {
    state.docsLoading = false; state.statsLoading = false; state.final_selected = 2;
  });

  it("counts only jury_review apps with a signed IC memo", () => {
    const { container } = render(<AdminPortalDefault />);
    expect(tabBadge(container, "Accepted")).toBe("2");
  });

  it("subtracts the raw jury_review list from the Applications badge", () => {
    const { container } = render(<AdminPortalDefault />);
    // 100 submitted - 10 rejected - 4 in jury_review (the list's exclusions)
    expect(tabBadge(container, "Applications")).toBe("86");
    expect(tabBadge(container, "Rejected")).toBe("10");
  });

  it("shows no Accepted badge while /stats is loading", () => {
    state.statsLoading = true;
    const { container } = render(<AdminPortalDefault />);
    expect(tabBadge(container, "Accepted")).toBeNull();
  });

  it("keeps Accepted=16 when the tab is switched before the list fetches finish", () => {
    // The jury_review pipeline + IC documents never settle (aborted by the
    // tab switch); /stats alone carries the count.
    state.docsLoading = true;
    state.final_selected = 16;
    const { container } = render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("Reviewers"));
    expect(tabBadge(container, "Accepted")).toBe("16");
    fireEvent.click(screen.getByText("Accepted"));
    expect(tabBadge(container, "Accepted")).toBe("16");
  });
});

describe("AdminPortal — Final Gate disabled", () => {
  it("sends a stale 'gate2' page id to the Accepted tab", () => {
    const { container } = render(<AdminPortalDefault />);
    fireEvent.click(screen.getByText("go-gate2"));
    const active = container.querySelector(".lp-tab.active");
    expect(within(active).getByText("Accepted")).toBeTruthy();
    expect(screen.getByLabelText("Search selected applications")).toBeInTheDocument();
  });
});
