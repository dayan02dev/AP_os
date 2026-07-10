// AdminGate2 v2 tests (Task 14) — real Final Gate pick matrix.
//
// The v2 screen reads the pipeline via useAdminData("pipeline"), filters the
// decision stack to chip === "JURY REVIEW" && picks_ready, shows a PICK MATRIX
// (which assigned jurors picked the startup + their notes) instead of a jury
// average, and records offered/waitlisted/on_hold/rejected via
// adminPlatformApi.decideGate2 (which injects gate_stage:"gate2").
//
// Seams: hooks/useAdminData (data) + lib/api.js (network). adminPlatformApi is
// the REAL module so we can assert gate_stage:"gate2" reaches the api layer.

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

// Mock the low-level api client so we can assert the exact POST body.
// adminPlatformApi.decideGate2 runs for real — it injects gate_stage:"gate2".
vi.mock("../../../../lib/api.js", () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { api } from "../../../../lib/api.js";
import { AdminGate2 } from "../screens/AdminGate2";

// ── Fixtures ────────────────────────────────────────────────────────────────

const READY_APP = {
  id: "app-1", track: "tir", name: "Karkhana Robotics", domain: "Robotics",
  stage: "Pilot", flag: "darkgreen", chip: "JURY REVIEW", picks_ready: true,
  ai: { overall: 8.4 }, founders: ["Aanya Mehta"],
  jury_assigned: 2,
  jury_assigned_names: ["Anand Mahindra", "Kiran Shaw"],
  picked_by: [
    { juror_user_id: "j1", name: "Anand Mahindra", note: "deep robotics expertise" },
  ],
};
// JURY REVIEW but picks not ready → excluded from the stack.
const NOT_READY_APP = {
  id: "app-2", track: "tir", name: "Not Ready Co", domain: "Bio",
  chip: "JURY REVIEW", picks_ready: false, ai: { overall: 7 },
  jury_assigned: 3, jury_assigned_names: [], picked_by: [],
};
// SHORTLISTED (even if picks_ready) → dropped (no longer eligible in v2).
const SHORTLISTED_READY = {
  id: "app-3", track: "sip", name: "Shortlisted Co", domain: "Fin",
  chip: "SHORTLISTED", picks_ready: true, ai: { overall: 6 },
  jury_assigned: 1, jury_assigned_names: [], picked_by: [],
};
// Already decided → appears in the History tab.
const DECIDED_APP = {
  id: "app-4", track: "tir", name: "Offered Co", domain: "MedTech",
  chip: "JURY REVIEW", picks_ready: true, gate2_decision: "offered",
  founders: ["Dr X"], ai: { overall: 9 },
  jury_assigned: 2, jury_assigned_names: ["Nandan N"],
  picked_by: [{ juror_user_id: "j5", name: "Nandan N", note: "great founder" }],
};

function setup(startups) {
  useAdminData.mockReturnValue({
    data: { startups }, loading: false, error: null, reload: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.post.mockResolvedValue({});
});

describe("AdminGate2 v2 — Final Gate pick matrix", () => {
  it("stack includes JURY REVIEW+picks_ready and excludes not-ready / SHORTLISTED", () => {
    setup([READY_APP, NOT_READY_APP, SHORTLISTED_READY]);
    render(<AdminGate2 goDetail={() => {}} />);
    // The only qualifying app is READY_APP.
    expect(screen.getByText("Karkhana Robotics")).toBeTruthy();
    expect(screen.queryByText("Not Ready Co")).toBeNull();
    expect(screen.queryByText("Shortlisted Co")).toBeNull();
  });

  it("stack renders the pick matrix (juror names + notes), not a jury average", () => {
    setup([READY_APP, NOT_READY_APP]);
    render(<AdminGate2 goDetail={() => {}} />);
    // Pick matrix: the juror who picked + their note.
    expect(screen.getByText(/Anand Mahindra/)).toBeTruthy();
    expect(screen.getByText(/deep robotics expertise/)).toBeTruthy();
    // Count line: N of M assigned jurors picked this startup.
    expect(screen.getByText(/1 of 2 assigned jurors picked/i)).toBeTruthy();
    // No jury-average anywhere.
    expect(screen.queryByText(/Jury Avg/i)).toBeNull();
  });

  it("keeps the AI screening context on the card", () => {
    setup([READY_APP]);
    render(<AdminGate2 goDetail={() => {}} />);
    expect(screen.getByText(/AI Screening Score/i)).toBeTruthy();
    expect(screen.getByText("8.4")).toBeTruthy();
  });

  it("Offer posts a gate_stage:'gate2' decision via decideGate2", async () => {
    setup([READY_APP]);
    render(<AdminGate2 goDetail={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Offer" }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toContain("/admin/platform/applications/tir/app-1/decision");
    expect(body).toMatchObject({ decision: "offered", gate_stage: "gate2" });
  });

  it("History tab shows a 'Picked by' column (not Jury Avg) with juror names", () => {
    setup([DECIDED_APP]);
    render(<AdminGate2 goDetail={() => {}} />);
    fireEvent.click(screen.getByText(/B · History/i));
    // Column header swapped from Jury Avg → Picked by.
    expect(screen.getByText(/Picked by/i)).toBeTruthy();
    expect(screen.queryByText(/Jury Avg/i)).toBeNull();
    // The decided app + its picker render.
    expect(screen.getByText("Offered Co")).toBeTruthy();
    expect(screen.getAllByText(/Nandan N/).length).toBeGreaterThan(0);
  });
});
