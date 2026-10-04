// Seam test: backend-shaped /admin/platform/pipeline rows (keys copied from
// backend/app/services/admin_query.py fetch_pipeline) → adaptPipelineRow →
// AdminPipeline. Covers ADM-17 search (display ID with/without prefix, email)
// and ADM-18 reco buckets agreeing with RecoCell.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { adaptPipelineRow } from "../../../../lib/adminDataAdapter";

const backendRow = (over) => ({
  id: "x", applicationId: "TIR-1", track: "tir", native_track: "tir", name: "P",
  founder: "F", industry: "Robotics", stage: "Lab", ai_score_overall: 7,
  status: "under_review", decision: null, decided_at: null, decided_by: null,
  gate1_decision: null, gate1_decided_at: null, gate1_decided_by: null,
  isHidden: false, isArchived: false, batch: null, batches: [],
  reviewer_score: null, reviewers: null, reviews_submitted: 0, reviewers_assigned: 0,
  reviewers_detached: 0, review_count: 0, reco: null, email: "f@x.io",
  submitted_at: "2026-07-01T00:00:00Z", flags: [], moved_to_track: null,
  jury_assigned: 0, jury_assigned_names: [], picked_by: [], picks_ready: false,
  gate2_decision: null, ...over,
});

const API_ROWS = [
  backendRow({ id: "a", applicationId: "TIR-27326", name: "Alpha", email: "sumit@artpark.in" }),
  backendRow({ id: "b", applicationId: "VIP-26255", track: "sip", name: "Beta", email: "b@x.io",
    review_count: 1, reviewers: { submitted: 1, assigned: 2 }, reco: { yes: 1, maybe: 0, no: 0 } }),
  backendRow({ id: "c", applicationId: "TIR-1001", name: "Gamma", email: "g@x.io",
    review_count: 2, reviewers: { submitted: 2, assigned: 2 }, reco: { yes: 2, maybe: 0, no: 0 } }),
];
const ROWS = API_ROWS.map(adaptPipelineRow);

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (key) =>
    key === "batches"
      ? { data: { batches: [] }, loading: false, error: null, reload: () => {} }
      : { data: { startups: ROWS }, loading: false, error: null, reload: () => {} },
}));

import { AdminPipeline, recoBucket } from "../screens/AdminPipeline.jsx";

let n = 0;
const mount = () => render(<AdminPipeline goDetail={() => {}} scopeKey={`seam${++n}`} />);
const rowNames = () => screen.getAllByTestId(/^pipeline-row-/).map((tr) => within(tr).getAllByRole("cell")[1].textContent);
const search = (q) => fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: q } });

describe("admin pipeline ↔ backend seam", () => {
  it("adapter keeps the founder email the backend sends", () => {
    expect(ROWS[0].email).toBe("sumit@artpark.in");
  });

  it.each([
    ["TIR-27326", ["Alpha"]],
    ["tir-27326", ["Alpha"]],
    ["  27326 ", ["Alpha"]],
    ["VIP-26255", ["Beta"]],
    ["SIP-26255", ["Beta"]],
    ["26255", ["Beta"]],
    ["artpark.in", ["Alpha"]],
    ["G@X.IO", ["Gamma"]],
  ])("search %j matches display ID / email", (q, want) => {
    mount();
    search(q);
    expect(rowNames()).toEqual(want);
  });

  it("recoBucket uses the same 'single' key as RecoCell for one review", () => {
    expect(ROWS.map(recoBucket)).toEqual(["none", "single", "yes"]);
    mount();
    const betaRow = screen.getAllByTestId(/^pipeline-row-/).find((tr) => tr.textContent.includes("Beta"));
    expect(within(betaRow).getByRole("button", { name: "Filter by reco: single" })).toBeTruthy();
    fireEvent.click(within(betaRow).getByRole("button", { name: "Filter by reco: single" }));
    expect(rowNames()).toEqual(["Beta"]);
  });
});
