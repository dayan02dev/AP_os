// Swarm-2 (reviewer_queue). Each test asserts CORRECT behaviour, so it fails
// on the bug it documents.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

const historyMock = vi.fn();
vi.mock("../../../../lib/reviewerApi.js", () => ({
  reviewerApi: { getHistory: (...a) => historyMock(...a), getQueue: vi.fn() },
}));

import ReviewerHistory from "../ReviewerHistory.jsx";
import ReviewerQueue from "../ReviewerQueue.jsx";
import ReviewerDashboard from "../ReviewerDashboard.jsx";
import { writeStickyState } from "../../../../hooks/useStickyState.js";
import { QUEUE_SCOPE } from "../../../../lib/reviewerQueueFilters.js";

const row = (o) => ({
  id: o.id, applicationId: "TIR-" + o.id, name: "Co" + o.id, founders: ["F"],
  industry: "Robotics", stage: "Prototype", track: "tir", movedToTrack: null,
  ai: { overall: 7 }, reviewStatus: "not-started", myScore: null, myReco: null,
  due: null, detached: false, closed: false, ...o,
});
const qa = (data) => ({ data, loading: false, error: null, reload: vi.fn() });

describe("REV-6 (still open): History degraded response", () => {
  it("does not tell a reviewer with an outage that they have no reviews", async () => {
    historyMock.mockResolvedValue({ stats: { total: 0 }, rows: [], degraded: true });
    render(<ReviewerHistory onOpenEval={() => {}} />);
    await vi.waitFor(() => expect(screen.queryByText(/Loading your history/i)).toBeNull());
    expect(screen.queryByText(/haven.t submitted any reviews yet/i)).toBeNull();
  });
});

describe("NEW: dashboard industry click lands on a queue still narrowed by other sticky filters", () => {
  it("shows every row the dashboard tile counted", () => {
    const rows = [row({ id: "1" }), row({ id: "2", reviewStatus: "submitted", myReco: "yes", myScore: 7 })];
    const dash = render(<ReviewerDashboard onPickIndustry={() => {}} queueAsync={qa(rows)} />);
    const tile = dash.container.querySelector(".dash-ind-row");
    expect(within(tile).getByText("Robotics")).toBeTruthy();
    expect(tile.querySelector(".dash-ind-count").textContent).toBe("2");
    dash.unmount();

    // Earlier in the session the reviewer left My Queue on VIP / Not started.
    writeStickyState(QUEUE_SCOPE, "track", "sip");
    writeStickyState(QUEUE_SCOPE, "status", "not-started");
    render(<ReviewerQueue onOpen={() => {}} initialDomain="Robotics" navKey="k1" queueAsync={qa(rows)} />);
    // Tile said "Robotics 2"; the pre-filtered queue should list 2 rows.
    expect(screen.queryByText("Co1")).not.toBeNull();
    expect(screen.queryByText("Co2")).not.toBeNull();
  });
});

describe("NEW: 'Show inactive (N)' ignores the active filters", () => {
  it("counts only inactive rows the current filters would reveal", () => {
    writeStickyState(QUEUE_SCOPE, "track", "tir");
    const rows = [
      row({ id: "1" }),
      row({ id: "2", track: "sip", applicationId: "SIP-2", reviewStatus: "submitted", detached: true }),
      row({ id: "3", track: "sip", applicationId: "SIP-3", reviewStatus: "submitted", closed: true }),
    ];
    render(<ReviewerQueue onOpen={() => {}} queueAsync={qa(rows)} />);
    // Both inactive rows are VIP; with the TIR filter on, toggling reveals 0.
    expect(screen.queryByRole("button", { name: /show inactive \(2\)/i })).toBeNull();
  });
});

describe("REV-17 (still open): dashboard AI component average treats null as 0", () => {
  it("averages only apps that have the dimension", () => {
    const rows = [
      row({ id: "1", ai: { overall: 8, problem: 8, solution: 8, tech: 8, founders: 8, commit: 8 } }),
      row({ id: "2", ai: { overall: 8, problem: 8, solution: 8, tech: null, founders: 8, commit: 8 } }),
    ];
    const { container } = render(<ReviewerDashboard onPickIndustry={() => {}} queueAsync={qa(rows)} />);
    const techRow = [...container.querySelectorAll(".dash-comp-row")]
      .find((r) => r.querySelector(".dash-comp-name").textContent === "Tech");
    expect(techRow.querySelector(".dash-comp-val").textContent).toMatch(/^8\.0/);
  });
});

describe("NEW: dashboard AI histogram / median", () => {
  it("puts an AI score of exactly 10.0 in the 9-10 bin", () => {
    const rows = [row({ id: "1", ai: { overall: 10 } }), row({ id: "2", ai: { overall: 9.5 } })];
    const { container } = render(<ReviewerDashboard onPickIndustry={() => {}} queueAsync={qa(rows)} />);
    const counts = [...container.querySelectorAll(".dash-hist-count")].map((n) => Number(n.textContent));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2); // N = 2
    expect(counts[9]).toBe(2);
  });

  it("MEDIAN of an even-sized set is the mean of the two middle values", () => {
    const rows = [row({ id: "1", ai: { overall: 6 } }), row({ id: "2", ai: { overall: 8 } })];
    render(<ReviewerDashboard onPickIndustry={() => {}} queueAsync={qa(rows)} />);
    const { container } = { container: document.body };
    expect(container.querySelector(".dash-hist-stats").textContent).toMatch(/MEDIAN 7\.0/);
  });
});
