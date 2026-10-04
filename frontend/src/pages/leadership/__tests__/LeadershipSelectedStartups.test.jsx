import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { id: "u1", email: "lead@x.io", roles: ["leadership"] }, logout: () => {} }),
}));

const row = (over) => ({
  track: "tir", native_track: "tir", display_id: "TIR-1", status: "accepted",
  project_name: "P", founder: { name: "F", affiliation: "O" },
  industry: { label: "Robotics" }, stage: { label: "Lab" },
  ai_score_overall: 7, submitted_at: "2026-07-01T00:00:00Z", ...over,
});

// Shortlist (status=jury_review): A signed, B unsigned, C moved TIR→VIP with a
// memo signed under its NATIVE track, D signed under the wrong (display) track,
// F has two current memos of which only one is signed (not selected).
const SHORTLIST = [
  row({ id: "A", project_name: "Alpha" }),
  row({ id: "B", project_name: "Bravo" }),
  row({ id: "C", project_name: "Charlie", track: "sip", native_track: "tir", moved_to_track: "sip" }),
  row({ id: "D", project_name: "Delta", track: "sip", native_track: "tir", moved_to_track: "sip" }),
  row({ id: "F", project_name: "Foxtrot" }),
];
const ALL = [...SHORTLIST, row({ id: "E", project_name: "Echo", status: "under_review" })];

vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getStats: vi.fn(() => Promise.resolve({
      totals: {}, funnel: {}, ai_score_overalls: [],
      status_counts: [{ id: "accepted", label: "Accepted", n: 4 }],
    })),
    getIndustryCategories: vi.fn(() => Promise.resolve({ categories: [] })),
    listApplications: vi.fn(),
  },
}));

vi.mock("../../../lib/icDocumentsApi.js", () => ({
  icDocumentsApi: { list: vi.fn() },
}));

import LeadershipDashboard from "../LeadershipDashboard.jsx";
import { leadershipApi } from "../../../lib/leadershipApi.js";
import { icDocumentsApi } from "../../../lib/icDocumentsApi.js";

const DOCS = {
  documents: [
    { track: "tir", application_id: "A", signed: true },
    { track: "tir", application_id: "B", signed: false },
    { track: "tir", application_id: "C", signed: true },
    { track: "sip", application_id: "D", signed: true },
    { track: "tir", application_id: "F", signed: true },
    { track: "tir", application_id: "F", signed: false },
  ],
};

async function openApps() {
  render(<MemoryRouter><LeadershipDashboard /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: /^Applications/i }));
  await waitFor(() => expect(screen.getByText("Echo")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Filters/i }));
}

describe("Leadership — Final selected (selected startups)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leadershipApi.listApplications.mockImplementation((p = {}) => {
      // Backend filters status=final_selected on its pipeline_stage (A + C).
      const rows = p.status === "jury_review" ? SHORTLIST
        : p.status === "final_selected" ? SHORTLIST.filter((r) => ["A", "C"].includes(r.id))
        : ALL;
      return Promise.resolve({ applications: rows, total: rows.length, limit: p.limit, offset: p.offset });
    });
    icDocumentsApi.list.mockResolvedValue(DOCS);
  });

  it("shows the chip with the selected count (native-track IC keys, every memo signed)", async () => {
    await openApps();
    const chip = await screen.findByRole("button", { name: /^Final selected/i });
    await waitFor(() => expect(within(chip).getByText("2")).toBeTruthy());   // A + C
  });

  it("labels selected rows Final selected and the rest Final pending", async () => {
    await openApps();
    const table = screen.getByRole("table");
    await waitFor(() => expect(within(table).getAllByText("Final selected")).toHaveLength(2));
    const alphaRow = screen.getByText("Alpha").closest("tr");
    expect(within(alphaRow).getByText("Final selected")).toBeTruthy();
    const bravoRow = screen.getByText("Bravo").closest("tr");
    expect(within(bravoRow).getByText("Final pending")).toBeTruthy();
    const foxRow = screen.getByText("Foxtrot").closest("tr");
    expect(within(foxRow).getByText("Final pending")).toBeTruthy();
    expect(within(table).queryByText("Accepted")).toBeNull();
  });

  it("filtering by the chip lists only selected startups, honouring other filters", async () => {
    await openApps();
    await waitFor(() => expect(icDocumentsApi.list).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /^Final selected/i }));
    await waitFor(() => expect(screen.queryByText("Echo")).toBeNull());
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Charlie")).toBeTruthy();
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.queryByText("Delta")).toBeNull();
    expect(screen.queryByText("Foxtrot")).toBeNull();
    expect(screen.getByText("2 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    await waitFor(() => {
      const calls = leadershipApi.listApplications.mock.calls.map((c) => c[0]);
      expect(calls.some((p) => p.status === "final_selected" && p.track === "tir")).toBe(true);
    });
    // Only backend-known values: the stage key, or jury_review (selection load).
    const statuses = leadershipApi.listApplications.mock.calls.map((c) => c[0].status);
    expect(statuses.every((s) => s === undefined || s === "jury_review" || s === "final_selected")).toBe(true);
  });

  it("never tags a row selected when the IC documents list fails", async () => {
    icDocumentsApi.list.mockRejectedValue(new Error("403"));
    await openApps();
    await waitFor(() => expect(icDocumentsApi.list).toHaveBeenCalled());
    expect(within(screen.getByRole("table")).queryByText("Final selected")).toBeNull();
    expect(screen.getByText("Echo")).toBeTruthy();
  });
});
