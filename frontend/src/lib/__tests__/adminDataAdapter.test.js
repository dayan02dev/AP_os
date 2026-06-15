import { describe, it, expect } from "vitest";
import { adaptPipelineRow, adaptStats, STATUS_TO_CHIP, DECISION_TO_ADMIN } from "../adminDataAdapter";

describe("adaptPipelineRow", () => {
  const row = {
    id: "u1", applicationId: "TIR-26013", track: "tir", name: "Karkhana Robotics",
    founder: "Aanya Mehta", industry: "Robotics & Automation", stage: "Pilot-ready",
    ai_score_overall: 8.4, status: "under_review", decision: null,
    isHidden: false, isArchived: false, batch: "Batch A", submitted_at: "2026-04-12T00:00:00Z",
  };
  it("maps status to chip and keeps identity fields", () => {
    const s = adaptPipelineRow(row);
    expect(s.id).toBe("u1");
    expect(s.name).toBe("Karkhana Robotics");
    expect(s.chip).toBe("IN REVIEW");
    expect(s.domain).toBe("Robotics & Automation");
    expect(s.founders).toEqual(["Aanya Mehta"]);
    expect(s.ai.overall).toBe(8.4);
    expect(s.flags).toEqual([]);
    expect(s.batch).toBe("Batch A");
    expect(s.track).toBe("tir");
  });
  it("maps decision to adminDecision and derives flag color", () => {
    expect(adaptPipelineRow({ ...row, decision: "shortlisted" }).adminDecision).toBe("APPROVED");
    expect(adaptPipelineRow({ ...row, status: "shortlisted" }).flag).toBe("darkgreen");
    expect(adaptPipelineRow({ ...row, status: "submitted" }).flag).toBe("orange");
  });
  it("defaults absent fields without faking scores", () => {
    const s = adaptPipelineRow({ ...row, ai_score_overall: null });
    expect(s.ai).toEqual({ overall: null });
    expect(s.rev).toBeUndefined();
    expect(s.variance).toBeNull();
  });
});

describe("adaptStats", () => {
  it("passes through the stats shape the dashboard reads", () => {
    const api = {
      totals: { apps_submitted: 250, advanced_past_review: 30, onboarded: 5, avg_ai_score: 8.3 },
      funnel: { submitted: 250, in_review: 200, advanced: 30, decided: 10 },
      status_counts: [{ id: "under_review", label: "Under review", n: 200 }],
      ai_score_overalls: [8.4, 7.2, 9.0],
      decisions: { shortlisted: 12, on_hold: 3, rejected: 8, waitlisted: 2 },
    };
    const d = adaptStats(api);
    expect(d.totals.apps_submitted).toBe(250);
    expect(d.aiScores).toEqual([8.4, 7.2, 9.0]);
    expect(d.decisions.shortlisted).toBe(12);
  });
});
