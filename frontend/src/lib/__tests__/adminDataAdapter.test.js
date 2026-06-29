import { describe, it, expect } from "vitest";
import { adaptPipelineRow, adaptStats, adaptDetail, STATUS_TO_CHIP, DECISION_TO_ADMIN,
  adaptReviewer, adaptCalibrationRow, adaptAuditEntry, adaptBatch } from "../adminDataAdapter";

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

describe("adaptDetail", () => {
  const detail = {
    id: "u1", track: "tir", display_id: "TIR-26013", project_name: "Karkhana Robotics",
    founder: { name: "Aanya Mehta", affiliation: "IISc" },
    industry: { id: "robotics", label: "Robotics & Automation" }, stage: "Pilot-ready",
    application: { status: "under_review", submitted_at: "2026-04-12T00:00:00Z" },
    ai_screening: {
      score_overall: 8.4, score_problem: 8.6, score_completeness: 8.2, score_tech: 9.0,
      score_founders: 7.8, score_commitment: 8.4, score_integrity: 8.4, summary: "TL;DR…",
    },
    reviews: [
      { reviewer_user_id: "r1", submitted_at: "2026-05-01T00:00:00Z",
        score_overall: 7.9, score_problem: 8, score_solution: 7.5, score_tech: 8.5,
        score_founders: 7.5, score_commitment: 8, recommendation: "yes",
        quick_notes: "Strong founder fit.", flags: ["Market competition risk"] },
    ],
    reviewer_assignments: [{ reviewer_user_id: "r1", state: "completed" }],
    decision: { decision: "shortlisted", rationale: "Strong" },
    meta: { is_hidden: false, is_archived: false },
    batch: { id: "b1", name: "Batch A" },
  };
  it("maps ai_screening categories to s.ai", () => {
    const s = adaptDetail(detail);
    expect(s.ai).toMatchObject({ overall: 8.4, problem: 8.6, solution: 8.2, tech: 9.0,
      founders: 7.8, commit: 8.4, integrity: 8.4 });
    expect(s.aiSummary).toBe("TL;DR…");
  });
  it("maps reviews[] to s.rev using REAL review columns", () => {
    const s = adaptDetail(detail);
    // score_solution → solution (NOT score_completeness), and quick_notes/flags map through.
    expect(s.rev).toMatchObject({ overall: 7.9, problem: 8, solution: 7.5, tech: 8.5,
      founders: 7.5, commit: 8, reco: "yes" });
    expect(s.rev.notes).toBe("Strong founder fit.");
    expect(s.rev.flags).toEqual(["Market competition risk"]);
    expect(s.rev.reviewerId).toBe("r1");
    // No integrity on a review.
    expect(s.rev.integrity).toBeUndefined();
    expect(s.reviews).toHaveLength(1);
  });
  it("averages category scores when score_overall is absent", () => {
    const s = adaptDetail({
      ...detail,
      reviews: [{ reviewer_user_id: "r2", submitted_at: "2026-05-02T00:00:00Z",
        score_problem: 8, score_solution: 6, score_tech: 8, score_founders: 6,
        score_commitment: 7, recommendation: "maybe" }],
    });
    // (8+6+8+6+7)/5 = 7.0
    expect(s.rev.overall).toBe(7.0);
    expect(s.rev.reco).toBe("maybe");
    expect(s.rev.flags).toEqual([]);
  });
  it("maps identity, decision, batch, assignments", () => {
    const s = adaptDetail(detail);
    expect(s.founders).toEqual(["Aanya Mehta", "IISc"]);
    expect(s.domain).toBe("Robotics & Automation");
    expect(s.adminDecision).toBe("APPROVED");
    expect(s.adminRationale).toBe("Strong");
    expect(s.batch).toBe("Batch A");
    expect(s.assignedReviewers).toEqual(["r1"]);
  });
  it("tolerates missing ai_screening / reviews", () => {
    const s = adaptDetail({ ...detail, ai_screening: null, reviews: [] });
    expect(s.ai).toEqual({ overall: null });
    expect(s.rev).toBeUndefined();
  });
  it("passes the raw application row through as `application`", () => {
    const d = { id: "a1", track: "tir", application: { problem_describe: "x", status: "submitted" } };
    expect(adaptDetail(d).application).toEqual({ problem_describe: "x", status: "submitted" });
  });
});

describe("reviewer flags surfacing", () => {
  it("adaptPipelineRow passes backend flags through", () => {
    expect(adaptPipelineRow({ id: "a", flags: ["f1", "f2"] }).flags).toEqual(["f1", "f2"]);
    expect(adaptPipelineRow({ id: "b" }).flags).toEqual([]);
  });
  it("adaptDetail aggregates flags from submitted reviews", () => {
    const d = { id: "x", reviews: [
      { submitted_at: "2026-06-01", flags: ["late"] },
      { submitted_at: "2026-06-02", flags: ["dup", "thin"] },
    ] };
    expect(adaptDetail(d).flags).toEqual(["late", "dup", "thin"]);
  });
});

describe("adaptPipelineRow reviewer score", () => {
  it("maps a numeric reviewer_score to rev.overall", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: 7.4 }).rev).toEqual({ overall: 7.4 });
  });
  it("leaves rev undefined when reviewer_score is null or absent", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: null }).rev).toBeUndefined();
    expect(adaptPipelineRow({ id: "a" }).rev).toBeUndefined();
  });
  it("treats a 0 score as a real score, not missing", () => {
    expect(adaptPipelineRow({ id: "a", reviewer_score: 0 }).rev).toEqual({ overall: 0 });
  });
});

import { adaptReviewer, adaptCalibrationRow, adaptAuditEntry, adaptBatch } from "../adminDataAdapter";
describe("misc adapters", () => {
  it("reviewer roster row", () => {
    const r = adaptReviewer({ user_id: "r1", name: "Vikram Sundar", email: "v@x.in",
      weight: 2.0, domains: ["Robotics"], batch: "Batch A", assigned: 12, completed: 9,
      progress: "9 / 12", consistency: 0.92, lastActivity: "2026-05-01T00:00:00Z" });
    expect(r).toMatchObject({ id: "r1", name: "Vikram Sundar", weight: 2.0, progress: "9 / 12",
      consistency: 0.92, domain: "Robotics" });
    // batches defaults to [] when absent
    expect(r.batches).toEqual([]);
  });
  it("reviewer roster row passes through batches", () => {
    const r = adaptReviewer({ user_id: "r2", name: "X", batches: [{ name: "Batch A", count: 12 }] });
    expect(r.batches).toEqual([{ name: "Batch A", count: 12 }]);
  });
  it("calibration + audit + batch", () => {
    expect(adaptCalibrationRow({ user_id: "r1", name: "V", n_reviews: 9, avg_score: 7.8,
      avg_variance_vs_ai: 0.6 }).variance).toBe(0.6);
    expect(adaptAuditEntry({ ts: "t", actor: "a", action: "x", target: "y", detail: "z" }).actor).toBe("a");
    expect(adaptBatch({ id: "b1", name: "Batch A", phase: "p1" }).name).toBe("Batch A");
  });
});
