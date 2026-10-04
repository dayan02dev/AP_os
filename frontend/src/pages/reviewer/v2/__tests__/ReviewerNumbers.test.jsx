// Reviewer portal numbers fix (2026-10-05): REV-01/02/04..11 front-end half.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const historyRows = [
  { reviewId: "r1", appId: "a1", track: "tir", name: "Alpha", date: "2026-07-01T00:00:00Z",
    myScore: 7, aiScore: 6.5, variance: 0.5, reco: "yes", adminDecision: "final_selected",
    canEdit: false, applicationId: "TIR-27061", org: "Alpha Org" },
  { reviewId: "r2", appId: "a2", track: "sip", name: "Beta", date: "2026-07-02T00:00:00Z",
    myScore: 5, aiScore: null, variance: null, reco: "no", adminDecision: "gate1_rejected",
    canEdit: false, applicationId: "SIP-26623", org: "Beta Org" },
  { reviewId: "r3", appId: "a3", track: "tir", name: "Gamma", date: "2026-07-03T00:00:00Z",
    myScore: 6, aiScore: 6, variance: 0, reco: "maybe", adminDecision: "pending",
    canEdit: true, applicationId: "TIR-27062", org: "Gamma Org" },
];

const contentMock = vi.fn();
vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: {
    getHistory: () =>
      Promise.resolve({ stats: { total: 3, avgVariance: 0.25 }, rows: historyRows }),
    getContent: (...a) => contentMock(...a),
    getQueue: () => Promise.resolve([]),
    getRubric: () => Promise.resolve({ dimensions: [], notes: [] }),
  },
}));

import ReviewerDashboard from "../ReviewerDashboard.jsx";
import ReviewerQueue from "../ReviewerQueue.jsx";
import ReviewerHistory from "../ReviewerHistory.jsx";
import ReviewerEval from "../ReviewerEval.jsx";
import { historyCsvRows, queueBadgeCount } from "../ReviewerPortal.jsx";

const mk = (data) => ({ data, loading: false, error: null, reload: vi.fn() });

const row = (over) => ({
  id: over.id, applicationId: "TIR-1", track: "tir", movedToTrack: null,
  name: "X", founders: [], industry: "Robotics", stage: "Lab", ai: { overall: 5 },
  reviewStatus: "not-started", myScore: null, myReco: null, due: null,
  detached: false, closed: false, ...over,
});

// ─── Dashboard ─────────────────────────────────────────────────────────

describe("ReviewerDashboard numbers", () => {
  const Q = [
    row({ id: "1", track: "tir" }),
    row({ id: "2", track: "tir", movedToTrack: "sip", reviewStatus: "submitted" }),
    row({ id: "3", track: "sip", reviewStatus: "submitted", detached: true }),
    row({ id: "4", track: "sip", reviewStatus: "submitted", closed: true }),
    row({ id: "5", track: "tir", reviewStatus: "draft" }),
  ];

  it("splits TIR/VIP by effective track and counts every submitted review", () => {
    render(<ReviewerDashboard queueAsync={mk(Q)} onPickIndustry={vi.fn()} />);
    const tile = screen.getByText("APPLICATIONS ASSIGNED").closest(".dash-stat-tile");
    const tir = within(tile).getByText("TIR").closest(".dash-track-row");
    const vip = within(tile).getByText("VIP").closest(".dash-track-row");
    expect(within(tir).getByText("2")).toBeInTheDocument();
    expect(within(vip).getByText("3")).toBeInTheDocument();
    const sub = screen.getByText("SUBMITTED", { selector: ".dash-stat-label" }).closest(".dash-stat-tile");
    expect(within(sub).getByText("3")).toBeInTheDocument();
  });

  it("has no always-zero IN PROGRESS pipeline row and labels the draft tile DRAFT", () => {
    render(<ReviewerDashboard queueAsync={mk(Q)} onPickIndustry={vi.fn()} />);
    expect(screen.queryByText("IN PROGRESS")).not.toBeInTheDocument();
    expect(screen.getAllByText("DRAFT").length).toBeGreaterThan(0);
  });

  it("does not render the industry 'All' chip as permanently active", () => {
    const pick = vi.fn();
    render(<ReviewerDashboard queueAsync={mk(Q)} onPickIndustry={pick} />);
    const all = screen.getByRole("button", { name: "All" });
    expect(all.className).not.toMatch(/\bactive\b/);
    fireEvent.click(all);
    expect(pick).toHaveBeenCalledWith("all");
  });
});

// ─── Queue ─────────────────────────────────────────────────────────────

describe("ReviewerQueue fixes", () => {
  it("an explicit 'All' pick from the dashboard clears a remembered industry", () => {
    const Q = [row({ id: "1", name: "RoboCo", industry: "Robotics" }),
               row({ id: "2", name: "HealthCo", industry: "Health" })];
    const first = render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Robotics" navKey="k1" queueAsync={mk(Q)} />);
    expect(screen.queryByText("HealthCo")).not.toBeInTheDocument();
    first.unmount();
    render(<ReviewerQueue onOpen={vi.fn()} initialDomain="all" navKey="k2" queueAsync={mk(Q)} />);
    expect(screen.getByText("HealthCo")).toBeInTheDocument();
    expect(screen.getByText("RoboCo")).toBeInTheDocument();
  });

  it("searches display IDs with or without the prefix (and VIP- for SIP-)", () => {
    const Q = [row({ id: "1", name: "Alpha", applicationId: "TIR-27061" }),
               row({ id: "2", name: "Beta", applicationId: "SIP-26623", track: "sip" })];
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    const box = screen.getByPlaceholderText(/search/i);
    fireEvent.change(box, { target: { value: "27061" } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: " tir-27061 " } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "VIP-26623" } });
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });

  it("sorts IDs by the displayed label and names case-insensitively", () => {
    const Q = [row({ id: "1", name: "aaditya", applicationId: "TIR-2" }),
               row({ id: "2", name: "ARPIT", applicationId: "SIP-1", track: "sip" }),
               row({ id: "3", name: "Bharat", applicationId: "TIR-10" })];
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    const names = () => screen.getAllByRole("row").slice(1).map((r) => r.cells[0].textContent);
    fireEvent.click(screen.getByText("ID"));
    // TIR-2 < TIR-10 (numeric) < VIP-1
    expect(names()[0]).toMatch(/^aaditya/);
    expect(names()[1]).toMatch(/^Bharat/);
    expect(names()[2]).toMatch(/^ARPIT/);
    fireEvent.click(screen.getByText("Project"));
    expect(names()[0]).toMatch(/^aaditya/);
    expect(names()[1]).toMatch(/^ARPIT/);
  });

  it("filters TIR/VIP by effective track", () => {
    const Q = [row({ id: "1", name: "Native", track: "tir" }),
               row({ id: "2", name: "Moved", track: "tir", movedToTrack: "sip" })];
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    expect(screen.getByText("Moved")).toBeInTheDocument();
    expect(screen.queryByText("Native")).not.toBeInTheDocument();
  });

  it("hides closed (rejected) rows by default behind a toggle and labels detached rows", () => {
    const Q = [row({ id: "1", name: "Open", reviewStatus: "submitted", detached: true }),
               row({ id: "2", name: "Shut", reviewStatus: "submitted", closed: true })];
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={mk(Q)} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.queryByText("Shut")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show closed \(1\)/i }));
    expect(screen.getByText("Shut")).toBeInTheDocument();
  });
});

// ─── History ───────────────────────────────────────────────────────────

describe("ReviewerHistory fixes", () => {
  it("labels gate decisions, shows IDs, AI/Δ, total and an Action column", async () => {
    render(<ReviewerHistory onOpenEval={vi.fn()} />);
    expect(await screen.findByText("Final selected")).toBeInTheDocument();
    expect(screen.getByText("1st-gate rejected")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^Decision$/ })).not.toBeInTheDocument();
    expect(screen.getByText(/VIP-26623/)).toBeInTheDocument();
    expect(screen.getByText(/3 evaluations/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "AI" })).toBeInTheDocument();
  });

  it("offers View (not Edit) when the review can no longer be edited", async () => {
    const open = vi.fn();
    render(<ReviewerHistory onOpenEval={open} />);
    const views = await screen.findAllByRole("button", { name: /View/ });
    expect(views).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Edit/ })).toHaveLength(1);
    fireEvent.click(views[0]);
    expect(open).toHaveBeenCalledWith("tir", "a1");
  });
});

describe("history CSV export", () => {
  it("builds rows from history (not the queue)", () => {
    const out = historyCsvRows(historyRows);
    expect(out[0]).toEqual(["Date", "ID", "Startup", "Track", "My score", "AI score",
      "Variance", "My reco", "Admin decision"]);
    expect(out[2][1]).toBe("VIP-26623");
    expect(out[2][8]).toBe("1st-gate rejected");
  });

  it("uses the effective track for a moved app", () => {
    const out = historyCsvRows([{ ...historyRows[0], track: "tir", movedToTrack: "sip" }]);
    expect(out[1][3]).toBe("VIP");
  });
});

describe("My Queue badge", () => {
  it("does not count closed rows hidden by default", () => {
    expect(queueBadgeCount([row({ id: "1" }), row({ id: "2", detached: true }),
      row({ id: "3", closed: true })])).toBe(2);
    expect(queueBadgeCount(null)).toBe(null);
  });
});

// ─── Eval ──────────────────────────────────────────────────────────────

const content = (over = {}) => ({
  id: "app1", applicationId: "TIR-1", track: "tir", moved_to_track: null,
  name: "Acme", aiSummary: null, aiSections: [], ai: null, fields: [], sections: [],
  attachments: [], application: {}, evaluation: null,
  assignment: { assignment_id: "a1" }, read_only: false, read_only_reason: null,
  app_status: "under_review", ...over,
});

describe("ReviewerEval read-only + effective track", () => {
  it("is read-only with a banner when the app is decided", async () => {
    contentMock.mockResolvedValueOnce(content({ read_only: true, read_only_reason: "decided", app_status: "rejected" }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/Decision already made \(rejected\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit evaluation/ })).toBeDisabled();
    expect(screen.getByPlaceholderText(/What stood out/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Re-open to edit/ })).not.toBeInTheDocument();
  });

  it("is read-only with a banner when the reviewer was unassigned", async () => {
    contentMock.mockResolvedValueOnce(content({
      read_only: true, read_only_reason: "unassigned", assignment: null,
      evaluation: { id: "rv1", submitted_at: "2026-07-01T00:00:00Z", recommendation: "yes",
        score_problem: 7, score_solution: 7, score_tech: 7, score_founders: 7,
        score_commitment: 7, quick_notes: "n" },
    }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    expect(await screen.findByText(/no longer assigned/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-open to edit/ })).not.toBeInTheDocument();
  });

  it("shows the effective track chip for a moved app", async () => {
    contentMock.mockResolvedValueOnce(content({ moved_to_track: "sip" }));
    render(<ReviewerEval track="tir" appId="app1" onBack={vi.fn()} />);
    await screen.findByText(/MOVED · TIR → VIP/);
    expect(screen.getByText("VIP", { selector: ".os-chip" })).toBeInTheDocument();
  });
});
