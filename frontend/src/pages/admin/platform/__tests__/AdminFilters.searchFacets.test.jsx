// Accepted tab + Manage drawer search/count regressions (VER-ADMF-1/2/3).
// Real components + real useAdminData + real adapters; only HTTP client
// modules are mocked, with backend-shaped payloads.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    getPipeline: vi.fn(), getBatches: vi.fn(), getApplication: vi.fn(),
    getReviewers: vi.fn(), getReviewerApplications: vi.fn(),
    bulkDecide: vi.fn(), decide: vi.fn(), moveTrack: vi.fn(), decideGate2: vi.fn(),
    bulkAssignReviewerApps: vi.fn(), bulkRemoveReviewerApps: vi.fn(),
    patchReviewer: vi.fn(), assignBatchReviewers: vi.fn(), unassignBatchReviewer: vi.fn(), deleteReviewer: vi.fn(),
  },
}));
vi.mock("../../../../lib/icDocumentsApi", () => ({ icDocumentsApi: { list: vi.fn(), fileUrl: vi.fn() } }));
vi.mock("../../../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: { email: "admin@artpark.in" } }) }));
vi.mock("../../../../lib/adminApi", () => ({ adminApi: { createUser: vi.fn() } }));

import { adminPlatformApi } from "../../../../lib/adminPlatformApi";
import { icDocumentsApi } from "../../../../lib/icDocumentsApi";
import { AdminSelectedApplications } from "../screens/AdminSelectedApplications";
import { ManageApplicationsDrawer } from "../screens/ManageApplicationsDrawer";

const item = (o) => ({
  id: o.id, applicationId: o.appId, track: o.track || "tir", native_track: o.native || o.track || "tir",
  name: o.name, org: o.org ?? null, founder: o.founder ?? "Founder", industry: o.industry ?? "Climate",
  stage: "Idea", ai_score_overall: o.ai ?? 6, status: o.status, decision: o.decision ?? null,
  decided_at: o.decidedAt ?? null, gate1_decision: o.g1 ?? null, isHidden: false, isArchived: false,
  batch: o.batches?.[0]?.name ?? null, batches: o.batches || [], reviewer_score: o.rev ?? null,
  reviewers: null, review_count: 0, reco: null, email: o.email ?? null,
  submitted_at: o.sub || "2026-07-01T00:00:00Z", flags: [], moved_to_track: o.moved ?? null,
  gate2_decision: o.g2 ?? null,
});
function servePipeline(rows) {
  adminPlatformApi.getPipeline.mockImplementation(async (p = {}) => {
    let r = rows;
    if (p.status) r = r.filter((x) => x.status === p.status);
    if (p.exclude_status) { const ex = p.exclude_status.split(","); r = r.filter((x) => !ex.includes(x.status)); }
    return { applications: r, total: r.length };
  });
  adminPlatformApi.getBatches.mockResolvedValue({ batches: [] });
  adminPlatformApi.getApplication.mockImplementation(() => new Promise(() => {}));
}
beforeEach(() => vi.clearAllMocks());

// ─── Accepted tab ───────────────────────────────────────────────────────────
describe("Accepted tab (AdminSelectedApplications)", () => {
  const ROWS = [
    item({ id: "j1", appId: "TIR-27701", name: "Alpha Robotics", org: "Alpha Org Pvt", founder: "Anil", email: "anil@alpha.in", industry: "Robotics", status: "jury_review" }),
    item({ id: "j2", appId: "TIR-27702", name: "Beta Climate", founder: "Bina", industry: "Climate", status: "jury_review" }),
    item({ id: "j3", appId: "VIP-26701", track: "sip", native: "sip", name: "Gamma", founder: "Gita", industry: "Health", status: "offered" }),
    item({ id: "j4", appId: "TIR-27703", track: "sip", native: "tir", moved: "sip", name: "Delta Moved", founder: "Dev", industry: "Climate", status: "jury_review" }),
  ];
  beforeEach(() => {
    servePipeline(ROWS);
    // j2 has a signed memo → accepted
    icDocumentsApi.list.mockResolvedValue({ documents: [
      { id: "d1", track: "tir", application_id: "j2", signed: true, uploaded_at: "2026-09-01" },
    ] });
  });
  const shown = () => [...document.querySelectorAll("tbody tr[data-testid^='row-']")].map((r) => r.dataset.testid.slice(4)).sort();
  const seg = (aria) => screen.getByRole("group", { name: aria });
  const segBtn = (aria, re) => within(seg(aria)).getByRole("button", { name: re });
  const countOf = (aria, re) => Number(/(\d+)$/.exec(segBtn(aria, re).textContent.trim())[1]);
  async function mountA() {
    const u = render(<AdminSelectedApplications goDetail={vi.fn()} />);
    await waitFor(() => expect(shown().length).toBe(4));
    await waitFor(() => expect(segBtn("Filter by decision", /Pending/).textContent).toMatch(/\d/));
    return u;
  }

  it("track filter by effective track; decision chip counts match rows under the track", async () => {
    await mountA();
    fireEvent.click(segBtn("Filter by track", /^VIP$/));
    expect(shown()).toEqual(["j3", "j4"]);
    for (const re of [/Pending/, /Accepted/]) {
      const n = countOf("Filter by decision", re);
      fireEvent.click(segBtn("Filter by decision", re));
      expect({ re: String(re), shown: shown().length }).toEqual({ re: String(re), shown: n });
      fireEvent.click(segBtn("Filter by decision", /^All/));
    }
  });

  it("decision chip counts match rows shown when a SEARCH is active", async () => {
    await mountA();
    fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: "alpha" } });
    expect(shown()).toEqual(["j1"]);
    const pending = countOf("Filter by decision", /Pending/);
    fireEvent.click(segBtn("Filter by decision", /Pending/));
    expect({ chip: "Pending", count: pending, shown: shown().length }).toEqual({ chip: "Pending", count: shown().length, shown: shown().length });
  });

  const searchCases = [
    ["name", "beta", ["j2"]], ["founder", "gita", ["j3"]], ["display ID", "TIR-27701", ["j1"]],
    ["VIP bare digits", "26701", ["j3"]], ["email", "anil@alpha.in", ["j1"]], ["TIR org", "alpha org", ["j1"]],
  ];
  for (const [what, q, ids] of searchCases) {
    it(`search by ${what}: "${q}"`, async () => {
      await mountA();
      fireEvent.change(screen.getByLabelText("Search selected applications"), { target: { value: q } });
      expect(shown()).toEqual(ids);
    });
  }

  it("filters sticky across remount; stale 'rejected' decision falls back to All", async () => {
    sessionStorage.setItem("apos.filter.v1.admin.selected.decision", JSON.stringify("rejected"));
    const u = await mountA();
    expect(segBtn("Filter by decision", /^All/).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(segBtn("Filter by track", /^TIR$/));
    u.unmount();
    render(<AdminSelectedApplications goDetail={vi.fn()} />);
    await waitFor(() => expect(shown()).toEqual(["j1", "j2"]));
  });
});

// ─── Manage drawer picker ───────────────────────────────────────────────────
describe("Manage Applications drawer — assign picker", () => {
  const PIPE = [
    item({ id: "p1", appId: "TIR-27801", name: "OpenOne", founder: "Olga", email: "olga@o.in", status: "under_review" }),
    item({ id: "p2", appId: "TIR-27802", name: "Rejected", status: "rejected" }),
    item({ id: "p3", appId: "VIP-26801", track: "sip", native: "sip", name: "Accepted", status: "jury_review" }),
    item({ id: "p4", appId: "TIR-27803", name: "Offered", status: "offered" }),
    item({ id: "p5", appId: "TIR-27804", name: "Withdrawn", status: "withdrawn" }),
    item({ id: "p6", appId: "TIR-27805", name: "OnHold", status: "on_hold" }),
    item({ id: "p7", appId: "TIR-27806", name: "AlreadyMine", status: "under_review" }),
    item({ id: "p8", appId: "TIR-27807", name: "Shortlisted", status: "shortlisted" }),
    item({ id: "p9", appId: "TIR-27808", name: "OrgOnly", org: "Zenith Labs", status: "submitted" }),
  ];
  beforeEach(() => {
    servePipeline(PIPE);
    // backend fetch_reviewer_applications row shape
    adminPlatformApi.getReviewerApplications.mockResolvedValue({ applications: [
      { id: "p7", track: "tir", effective_track: "tir", display_id: "TIR-27806", project: "AlreadyMine",
        industry: "Climate", status: "under_review", batch: null, reviewStatus: "pending", assignment_id: "as1", detached: false },
    ] });
  });
  const candNames = () => [...document.querySelectorAll("input[aria-label^='Assign candidate ']")].map((i) => i.getAttribute("aria-label").replace("Assign candidate ", "")).sort();
  async function open() {
    render(<ManageApplicationsDrawer reviewer={{ id: "rv1", name: "R One", batches: [] }} onClose={vi.fn()} />);
    await waitFor(() => expect(candNames().length).toBeGreaterThan(0));
  }

  it("hides closed apps (rejected/accepted/offered/withdrawn) and live-assigned ones; keeps on_hold/shortlisted", async () => {
    await open();
    expect(candNames()).toEqual(["OnHold", "OpenOne", "OrgOnly", "Shortlisted"]);
  });

  const cases = [["display ID", "TIR-27801", ["OpenOne"]], ["bare digits", "27801", ["OpenOne"]],
    ["founder", "olga", ["OpenOne"]], ["email", "olga@o.in", ["OpenOne"]], ["TIR org", "zenith", ["OrgOnly"]]];
  for (const [what, q, ids] of cases) {
    it(`picker search by ${what}`, async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Search applications to assign"), { target: { value: q } });
      expect(candNames()).toEqual(ids);
    });
  }
});

