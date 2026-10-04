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
  it("pushes single-status stages to the API", () => {
    expect(stageQuery("reviewed")).toEqual({ status: "evaluated", keep: null });
  });
  it("narrows split stages client-side", () => {
    const q = stageQuery("final_rejected");
    expect(q.status).toBe("rejected");
    expect(q.keep({ status: "rejected", gate2_decision: "rejected" })).toBe(true);
    expect(q.keep({ status: "rejected", gate2_decision: null })).toBe(false);
    const g1 = stageQuery("gate1_rejected");
    expect(g1.keep({ status: "rejected", gate2_decision: null })).toBe(true);
  });
  it("fetches multi-status stages unfiltered and keeps matching rows", () => {
    const q = stageQuery("submitted");
    expect(q.status).toBeUndefined();
    expect(q.keep({ status: "ai_screening" })).toBe(true);
    expect(q.keep({ status: "evaluated" })).toBe(false);
  });
});

describe("recoQuery", () => {
  it("splits the dash bucket into no reviews vs one review", () => {
    const none = recoQuery("none");
    const single = recoQuery("single");
    expect(none.recommendation).toBeUndefined();
    expect(none.keep({ reco: { yes: 0, maybe: 0, no: 0 } })).toBe(true);
    expect(none.keep({ reco: { yes: 1 } })).toBe(false);
    expect(single.keep({ reco: { yes: 1 } })).toBe(true);
    expect(single.keep({ review_count: 2, reco: { yes: 1 } })).toBe(false);
    expect(recoQuery("yes")).toEqual({ recommendation: "yes", keep: null });
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
