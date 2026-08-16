import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MilestonesRisksPanel from "../components/MilestonesRisksPanel.jsx";

const risk = (over = {}) => ({
  data: { severity: "red", what_happened: "Vendor slip", impact: "2wk delay", mitigation: "2nd vendor", ...over },
});

describe("MilestonesRisksPanel", () => {
  it("data === null, state 6 (not_due_yet) — exact copy, same wording as Task 5's panel", () => {
    render(
      <MilestonesRisksPanel
        data={null}
        emptyReason={{ cause: "not_due_yet", due_date: "2026-07-05", due_label: "June 2026" }}
      />,
    );
    expect(
      screen.getByText("No monthly update filed yet — your first one is due 2026-07-05."),
    ).toBeInTheDocument();
  });

  it("data === null, state 7 (overdue_backlog) — exact copy, distinct from state 6", () => {
    render(
      <MilestonesRisksPanel
        data={null}
        emptyReason={{ cause: "overdue_backlog", count: 3, oldest_label: "April 2026", oldest_due: "2026-05-05" }}
      />,
    );
    expect(
      screen.getByText(
        "No monthly update filed yet — 3 period(s) are overdue, starting with April 2026 (due 2026-05-05).",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/your first one is due/i)).not.toBeInTheDocument();
  });

  it("milestones grouped correctly by status, with a Done row never appearing in any group even if the input carried one (render-layer guard)", () => {
    const data = {
      period_label: "June 2026",
      milestones_by_status: {
        // Simulates what would land here if some future upstream change
        // stopped filtering "Done" out before this panel ever sees it —
        // the render layer must not trust an unknown key blindly.
        Done: [{ data: { milestone: "Ship v1", status: "Done", owner: "A" } }],
        "On Track": [{ data: { milestone: "Pilot #2", status: "On Track", owner: "B" } }],
        "At Risk": [],
        Blocked: [],
      },
      risks: [],
    };
    render(<MilestonesRisksPanel data={data} emptyReason={null} />);
    expect(screen.getByText("Pilot #2")).toBeInTheDocument();
    expect(screen.queryByText("Ship v1")).not.toBeInTheDocument();
  });

  it("zero milestones + 2 risks: milestones empty-copy next to real risk rows (independent, not a shared empty state)", () => {
    const data = {
      period_label: "June 2026",
      milestones_by_status: { "On Track": [], "At Risk": [], Blocked: [] },
      risks: [risk({ what_happened: "Vendor slip" }), risk({ severity: "amber", what_happened: "Hiring delay" })],
    };
    render(<MilestonesRisksPanel data={data} emptyReason={null} />);
    expect(screen.getByText(/No open milestones this period/i)).toBeInTheDocument();
    expect(screen.getByText("Vendor slip")).toBeInTheDocument();
    expect(screen.getByText("Hiring delay")).toBeInTheDocument();
    expect(screen.queryByText(/No risks reported this period/i)).not.toBeInTheDocument();
  });

  it("zero risks + real milestones: risks empty-copy next to real milestone rows", () => {
    const data = {
      period_label: "June 2026",
      milestones_by_status: {
        "On Track": [{ data: { milestone: "Pilot #2", status: "On Track", owner: "B" } }],
        "At Risk": [], Blocked: [],
      },
      risks: [],
    };
    render(<MilestonesRisksPanel data={data} emptyReason={null} />);
    expect(screen.getByText(/No risks reported this period/i)).toBeInTheDocument();
    expect(screen.getByText("Pilot #2")).toBeInTheDocument();
    expect(screen.queryByText(/No open milestones this period/i)).not.toBeInTheDocument();
  });

  it("a risk's severity renders the correct badge color for red vs amber", () => {
    const data = {
      period_label: "June 2026",
      milestones_by_status: { "On Track": [], "At Risk": [], Blocked: [] },
      risks: [risk({ severity: "red" }), risk({ severity: "amber" })],
    };
    render(<MilestonesRisksPanel data={data} emptyReason={null} />);
    expect(document.querySelector(".vipd-risk-badge-red")).toBeInTheDocument();
    expect(document.querySelector(".vipd-risk-badge-amber")).toBeInTheDocument();
  });
});
