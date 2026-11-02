import { describe, expect, it } from "vitest";

import {
  reviewRowToEvaluation,
  evaluationToPayload,
  evaluationToPatch,
  weightedOverall,
  initialsOf,
  DIM_KEYS,
  AI_DIM_KEYS,
  CRIT_LABELS,
} from "../ui.jsx";

// Rubric v3.2 (contract C3): reviewers score 4 criteria; "Commitment to be
// fully available" is gone from the reviewer form, payloads and math. The AI
// screening scores keep their commitment dimension (AI panel only).
describe("rubric v3.2 dimensions", () => {
  it("the reviewer form scores exactly the four criteria", () => {
    expect(DIM_KEYS).toEqual(["problem", "solution", "tech", "founders"]);
  });

  it("the AI panel still shows the AI commitment score", () => {
    expect(AI_DIM_KEYS).toEqual(["problem", "solution", "tech", "founders", "commit"]);
    expect(CRIT_LABELS.commit).toBe("Commitment");
  });
});

describe("reviewRowToEvaluation", () => {
  it("maps a full review row to the UI evaluation shape", () => {
    const row = {
      id: "rev-1",
      submitted_at: "2026-06-01T10:00:00Z",
      score_problem: 8,
      score_solution: 6,
      score_tech: 7,
      score_founders: 9,
      score_commitment: 5,
      quick_notes: "solid team",
      disagree_with_ai: { problem: true },
      flags: ["conflict"],
      recommendation: "advance",
      locked_at: "2026-06-02T10:00:00Z",
    };
    const ev = reviewRowToEvaluation(row);
    expect(ev.reviewId).toBe("rev-1");
    expect(ev.status).toBe("submitted");
    // A historical score_commitment is not carried into the form.
    expect(ev.scores).toEqual({ problem: 8, solution: 6, tech: 7, founders: 9 });
    expect(ev.notes).toBe("solid team");
    expect(ev.disagreements).toEqual({ problem: true });
    expect(ev.flags).toEqual(["conflict"]);
    expect(ev.recommendation).toBe("advance");
    expect(ev.editWindowExpiresAt).toBe("2026-06-02T10:00:00Z");
  });

  it("flags status as draft when not submitted", () => {
    const ev = reviewRowToEvaluation({ id: "rev-2", submitted_at: null, score_problem: 4 });
    expect(ev.status).toBe("draft");
    expect(ev.scores.problem).toBe(4);
    // missing score columns default to 5.0
    expect(ev.scores.solution).toBe(5.0);
  });

  it("returns sensible defaults for a null/empty row", () => {
    const ev = reviewRowToEvaluation(null);
    expect(ev.reviewId).toBeNull();
    expect(ev.status).toBe("not-started");
    expect(ev.scores).toEqual({ problem: 5.0, solution: 5.0, tech: 5.0, founders: 5.0 });
    expect(ev.recommendation).toBeNull();
    expect(ev.notes).toBe("");
    expect(ev.disagreements).toEqual({});
    expect(ev.flags).toEqual([]);
    expect(ev.editWindowExpiresAt).toBeNull();
  });

  it("coerces non-array flags and null score columns to defaults", () => {
    const ev = reviewRowToEvaluation({
      id: "rev-3",
      score_problem: null,
      score_tech: "7",
      score_commitment: "7",
      flags: null,
      disagree_with_ai: null,
    });
    expect(ev.scores.problem).toBe(5.0);
    expect(ev.scores.tech).toBe(7); // numeric string coerced
    expect(ev.scores).not.toHaveProperty("commit");
    expect(ev.flags).toEqual([]);
    expect(ev.disagreements).toEqual({});
  });
});

describe("evaluationToPayload", () => {
  const ev = {
    scores: { problem: 8, solution: 6, tech: 7, founders: 9 },
    recommendation: "advance",
    notes: "great",
    disagreements: { tech: true },
    flags: ["x"],
  };
  const application = { id: "app-1", track: "tir", assignmentId: "asg-1" };

  it("maps the UI shape to DB columns with identity fields and draft flag", () => {
    const payload = evaluationToPayload(ev, { application, draft: true });
    expect(payload).toEqual({
      application_id: "app-1",
      application_track: "tir",
      assignment_id: "asg-1",
      score_problem: 8,
      score_solution: 6,
      score_tech: 7,
      score_founders: 9,
      recommendation: "advance",
      quick_notes: "great",
      disagree_with_ai: { tech: true },
      flags: ["x"],
      draft: true,
    });
  });

  it("never sends score_commitment and maps notes→quick_notes", () => {
    const payload = evaluationToPayload(ev, { application, draft: false });
    expect(payload).not.toHaveProperty("score_commitment");
    expect(payload.quick_notes).toBe("great");
    expect(payload.draft).toBe(false);
  });
});

describe("evaluationToPatch", () => {
  const ev = {
    scores: { problem: 8, solution: 6, tech: 7, founders: 9 },
    recommendation: "hold",
    notes: "needs work",
    disagreements: {},
    flags: [],
  };

  it("maps scores/notes/disagreements to DB columns without identity fields", () => {
    const patch = evaluationToPatch(ev, { draft: true });
    expect(patch).toEqual({
      score_problem: 8,
      score_solution: 6,
      score_tech: 7,
      score_founders: 9,
      recommendation: "hold",
      quick_notes: "needs work",
      disagree_with_ai: {},
      flags: [],
      draft: true,
    });
    expect(patch).not.toHaveProperty("application_id");
    expect(patch).not.toHaveProperty("assignment_id");
  });

  it("omits the draft flag when draft is undefined", () => {
    const patch = evaluationToPatch(ev, {});
    expect(patch).not.toHaveProperty("draft");
    expect(patch).not.toHaveProperty("score_commitment");
    expect(patch.quick_notes).toBe("needs work");
  });
});

describe("weightedOverall", () => {
  it("computes the weighted mean over 4 criteria (22/30/22/14, /88)", () => {
    const scores = { problem: 8, solution: 6, tech: 7, founders: 9 };
    expect(weightedOverall(scores)).toBe(7.23); // 636/88 at 2 dp, like the backend (RM-1)
  });

  it("ignores a stray commit score", () => {
    const scores = { problem: 8, solution: 6, tech: 7, founders: 9, commit: 0 };
    expect(weightedOverall(scores)).toBe(7.23);
  });

  it("a brand-new review's default payload carries no commitment score", () => {
    const p = evaluationToPayload(reviewRowToEvaluation(null), {
      application: { id: "a", track: "sip", assignmentId: "x" }, draft: false,
    });
    expect(p).not.toHaveProperty("score_commitment");
  });

  it("averages over present weights, skipping missing scores", () => {
    // Only solution present → mean is just that score.
    expect(weightedOverall({ solution: 6 })).toBeCloseTo(6, 5);
  });

  it("returns 0 when no scores are present", () => {
    expect(weightedOverall({})).toBe(0);
  });
});

describe("initialsOf", () => {
  it("returns first+last initials for a two-part name", () => {
    expect(initialsOf("Vikram Sundar")).toBe("VS");
  });

  it("returns a single initial for a single name", () => {
    expect(initialsOf("Madonna")).toBe("M");
  });

  it("falls back to email when name is empty", () => {
    expect(initialsOf("", "alice@example.com")).toBe("AL");
  });

  it("falls back to RV when both name and email are empty", () => {
    expect(initialsOf("", "")).toBe("RV");
    expect(initialsOf()).toBe("RV");
  });
});
