import { describe, expect, it } from "vitest";
import {
  breakdownFor, recoQuery, rowStage, stageQuery, statusLabel,
} from "../pipelineStages.js";
import { allSignedDocKeys } from "../selectedStartups.js";

const sel = new Set(["tir:A"]);

describe("rowStage", () => {
  it("splits rejected by the gate-2 decision", () => {
    expect(rowStage({ status: "rejected", gate2_decision: "rejected" }).label).toBe("Final rejected");
    expect(rowStage({ status: "rejected", gate2_decision: null }).label).toBe("1st-gate rejected");
    // Field not shipped yet → plain "Rejected", never a guess.
    expect(rowStage({ status: "rejected" }).label).toBe("Rejected");
  });
  it("labels jury_review as Final pending / Final selected, never Accepted", () => {
    expect(rowStage({ id: "A", track: "tir", status: "jury_review" }, { selectedKeys: sel }).label).toBe("Final selected");
    expect(rowStage({ id: "B", track: "tir", status: "jury_review" }, { selectedKeys: sel }).label).toBe("Final pending");
    // Legacy overlay status "accepted" is the same thing.
    expect(rowStage({ id: "B", track: "tir", status: "accepted" }).label).toBe("Final pending");
    // Backend row flag wins over the client key set.
    expect(rowStage({ id: "B", track: "tir", status: "jury_review", final_selected: true }).label).toBe("Final selected");
  });
  it("prefers the backend's pipeline_stage over the overlaid status", () => {
    // Backend row: status is the decision-overlaid display status, while
    // pipeline_stage is computed from the RAW status + gate-2 decision.
    expect(rowStage({ status: "rejected", pipeline_stage: "final_rejected", gate2_decision: "rejected" }).id)
      .toBe("final_rejected");
    expect(rowStage({ status: "rejected", pipeline_stage: "gate1_rejected", gate2_decision: null }).id)
      .toBe("gate1_rejected");
    expect(rowStage({ status: "jury_review", pipeline_stage: "final_selected" }).label).toBe("Final selected");
    expect(rowStage({ status: "rejected", pipeline_stage: "reviewed" }).label).toBe("Reviewed");
  });
  it("uses the admin bucket names", () => {
    expect(rowStage({ status: "under_review" }).label).toBe("Under review");
    expect(rowStage({ status: "evaluated" }).label).toBe("Reviewed");
    expect(rowStage({ status: "ai_screening" }).label).toBe("Submitted");
  });
  it("statusLabel never says Accepted for jury_review", () => {
    expect(statusLabel("jury_review")).toBe("Final round");
    expect(statusLabel("evaluated")).toBe("Reviewed");
  });
});

describe("stageQuery", () => {
  it("sends the backend's stage keys as status (filtered server-side)", () => {
    for (const id of ["reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"]) {
      expect(stageQuery(id)).toEqual({ status: id, keep: null });
    }
  });
  it("pushes other single-status stages as their raw status", () => {
    expect(stageQuery("under_review")).toEqual({ status: "under_review", keep: null });
  });
  it("fetches multi-status stages unfiltered and keeps matching rows", () => {
    const q = stageQuery("submitted");
    expect(q.status).toBeUndefined();
    expect(q.keep({ status: "ai_screening" })).toBe(true);
    expect(q.keep({ status: "evaluated" })).toBe(false);
  });
});

describe("recoQuery", () => {
  it("sends every reco bucket to the API, incl. none (0 reviews) and single (1)", () => {
    for (const v of ["yes", "maybe", "no", "none", "single"]) {
      expect(recoQuery(v)).toEqual({ recommendation: v, keep: null });
    }
    expect(recoQuery(null)).toEqual({ recommendation: undefined, keep: null });
  });
});

describe("breakdownFor", () => {
  it("returns null when the backend has no pipeline_breakdown yet", () => {
    expect(breakdownFor({}, null)).toBeNull();
  });
  it("narrows to a track", () => {
    const pb = { total: 3, stages: { reviewed: 3 }, by_track: { tir: { total: 1, stages: { reviewed: 1 } } } };
    expect(breakdownFor({ pipeline_breakdown: pb }, "tir").total).toBe(1);
    expect(breakdownFor({ pipeline_breakdown: pb }, null).total).toBe(3);
  });
});

describe("allSignedDocKeys", () => {
  it("requires EVERY current IC document to be signed", () => {
    const keys = allSignedDocKeys([
      { track: "tir", application_id: "A", signed: true },
      { track: "tir", application_id: "A", signed: true },
      { track: "tir", application_id: "B", signed: true },
      { track: "tir", application_id: "B", signed: false },
    ]);
    expect([...keys]).toEqual(["tir:A"]);
  });
});
