// ManageJurorsDrawer v2 tests (Task 13).
//
// v2 differences from the port:
//   • Candidate list = pipeline rows with chip === "JURY REVIEW" only.
//   • Candidates carry a recommendation (score/reason) for this juror and sort
//     recommended-first with a score badge.
//   • Remove error code "app_already_decided" → Final-Gate-frozen message.
//   • Assigned rows show a green "★ picked" chip when the juror picked the app.

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
}));

vi.mock("../../../../lib/leadershipApi", () => ({
  leadershipApi: {
    assignJurors: vi.fn().mockResolvedValue({ results: [{ status: "created" }] }),
    unassignJuror: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../lib/leadershipApi";
import { ManageJurorsDrawer } from "../screens/ManageJurorsDrawer";

const JUROR = { id: "juror-001", name: "Anand Mahindra", domain: "Robotics" };

// jurorApplications rows (already adapted → carry `picked`, no `chip`/`batch`).
const ASSIGNED_APPS = [
  { id: "app-101", track: "tir", project: "Karkhana Robotics", industry: "Robotics", status: "jury_review", picked: true },
  { id: "app-102", track: "sip", project: "Saathi Health AI", industry: "MedTech", status: "jury_review", picked: false },
];

// pipeline candidates: one JURY REVIEW (eligible, with a recommendation), one
// SHORTLISTED (must be excluded from the candidate picker in v2).
const CANDIDATES = [
  { id: "app-200", track: "tir", name: "Mihira Diagnostics", domain: "HealthTech", chip: "JURY REVIEW", recommendation: { score: 87, reason: "strong domain fit" } },
  { id: "app-201", track: "tir", name: "Should Not Be Candidate", domain: "Bio", chip: "SHORTLISTED" },
];

function setup({ assigned = ASSIGNED_APPS, candidates = CANDIDATES } = {}) {
  useAdminData.mockImplementation((kind) => {
    if (kind === "jurorApplications")
      return { data: { applications: assigned }, loading: false, error: null, reload: vi.fn() };
    if (kind === "pipeline")
      return { data: { startups: candidates }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

describe("ManageJurorsDrawer v2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders assigned applications and juror name", () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/Anand Mahindra/)).toBeTruthy();
    expect(screen.getByText(/Assigned Applications \(2\)/)).toBeTruthy();
    expect(screen.getByText("Karkhana Robotics")).toBeTruthy();
    expect(screen.getByText("Saathi Health AI")).toBeTruthy();
  });

  it("shows a ★ picked chip only on apps the juror picked", () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    // app-101 picked → exactly one picked chip
    expect(screen.getAllByText(/★ picked/).length).toBe(1);
  });

  it("limits candidates to JURY REVIEW rows", () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    const select = screen.getByLabelText("Application");
    const optionText = within(select).getAllByRole("option").map(o => o.textContent).join(" | ");
    expect(optionText).toMatch(/Mihira Diagnostics/);
    expect(optionText).not.toMatch(/Should Not Be Candidate/);
    // recommendation score surfaces as a badge in the option label
    expect(optionText).toMatch(/87/);
  });

  it("assign calls leadershipApi.assignJurors(appId, track, { juror_user_ids })", async () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText("Application"), { target: { value: "app-200" } });
    fireEvent.click(screen.getByText("Assign Application"));
    await waitFor(() =>
      expect(leadershipApi.assignJurors).toHaveBeenCalledWith(
        "app-200", "tir", { juror_user_ids: ["juror-001"] }));
  });

  it("surfaces not_eligible_for_jury as a friendly error", async () => {
    setup();
    leadershipApi.assignJurors.mockRejectedValueOnce(Object.assign(new Error("Conflict"), {
      status: 409, code: "not_eligible_for_jury", details: { code: "not_eligible_for_jury" },
    }));
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText("Application"), { target: { value: "app-200" } });
    fireEvent.click(screen.getByText("Assign Application"));
    await waitFor(() =>
      expect(screen.getByText(/not in Jury Review|not eligible/i)).toBeTruthy());
  });

  it("remove calls unassignJuror and shows the Final-Gate-frozen message on app_already_decided", async () => {
    setup();
    leadershipApi.unassignJuror.mockRejectedValueOnce(Object.assign(new Error("Conflict"), {
      status: 409, code: "app_already_decided", details: { code: "app_already_decided" },
    }));
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    const removeBtns = screen.getAllByText("Remove");
    fireEvent.click(removeBtns[0]);
    await waitFor(() =>
      expect(leadershipApi.unassignJuror).toHaveBeenCalledWith("app-101", "tir", "juror-001"));
    await waitFor(() =>
      expect(screen.getByText(/Final Gate decision/i)).toBeTruthy());
  });

  it("shows an empty state when no applications are assigned", () => {
    setup({ assigned: [] });
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/No applications assigned/i)).toBeTruthy();
  });
});
