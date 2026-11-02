import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewerFeedback, { AdminDecisionList, isAutoRationale } from "../ReviewerFeedback.jsx";

describe("ReviewerFeedback", () => {
  it("renders recommendation, notes, flags, strengths, concerns, legacy comments and AI disagreements", () => {
    render(<ReviewerFeedback review={{
      recommendation: "maybe", quick_notes: "Strong team, weak GTM",
      flags: ["Budget unclear"], strengths: "Deep IP", concerns: "Burn",
      comments: "Legacy note", disagree_with_ai: { tech: "AI overrated the tech" },
    }} />);
    expect(screen.getByText("Maybe")).toBeTruthy();
    expect(screen.getByText("Strong team, weak GTM")).toBeTruthy();
    expect(screen.getByText("Budget unclear")).toBeTruthy();
    expect(screen.getByText("Deep IP")).toBeTruthy();
    expect(screen.getByText("Burn")).toBeTruthy();
    expect(screen.getByText("Legacy note")).toBeTruthy();
    expect(screen.getByText(/AI overrated the tech/)).toBeTruthy();
  });

  it("says so when a review has no written feedback", () => {
    render(<ReviewerFeedback review={{ disagree_with_ai: {} }} />);
    expect(screen.getByText(/No written feedback/)).toBeTruthy();
  });
});

describe("AdminDecisionList", () => {
  it("lists admin decisions with rationale and author, newest first as given", () => {
    render(<AdminDecisionList decisions={[
      { id: "2", gate_stage: "gate1", decision: "approved", rationale: "Great fit for climate cohort", decided_by_name: "Asha", decided_at: "2026-10-02T10:00:00Z" },
      { id: "1", gate_stage: "gate1", decision: "on_hold", rationale: "gate1: on_hold", decided_by_name: "Asha", decided_at: "2026-10-01T10:00:00Z" },
    ]} />);
    expect(screen.getByText("Great fit for climate cohort")).toBeTruthy();
    expect(screen.getAllByText(/Asha/).length).toBe(2);
    // auto-generated rationale is not shown as feedback text
    expect(screen.queryByText("gate1: on_hold")).toBeNull();
  });

  it("renders nothing when there are no decisions", () => {
    const { container } = render(<AdminDecisionList decisions={[]} />);
    expect(container.textContent).toBe("");
  });

  it("detects auto-generated rationales", () => {
    expect(isAutoRationale("gate1: rejected")).toBe(true);
    expect(isAutoRationale("Batch decision — REJECTED")).toBe(true);
    expect(isAutoRationale("Admin override: approved")).toBe(true);
    expect(isAutoRationale("Weak market evidence")).toBe(false);
    expect(isAutoRationale("")).toBe(true);
  });

  it("treats the leadership default '<decision> by leadership' rationale as automatic", () => {
    for (const d of ["shortlisted", "on_hold", "rejected", "waitlisted", "jury_review", "offered"]) {
      expect(isAutoRationale(`${d} by leadership`)).toBe(true);
    }
    expect(isAutoRationale("Rejected by leadership after the panel call")).toBe(false);
  });

  it("labels every decision value admin_decisions can hold", () => {
    const vals = ["shortlisted", "on_hold", "rejected", "waitlisted", "jury_review", "offered"];
    const { container } = render(<AdminDecisionList decisions={vals.map((d, i) => ({
      id: "d" + i, gate_stage: "gate1", decision: d, rationale: "Because.", decided_at: null }))} />);
    const labels = [...container.querySelectorAll(".review-card-name")].map((n) => n.textContent);
    expect(labels).toEqual(["Shortlisted · 1st gate", "On hold · 1st gate", "Rejected · 1st gate",
      "Waitlisted · 1st gate", "Sent to final round · 1st gate", "Offered · 1st gate"]);
  });
});
