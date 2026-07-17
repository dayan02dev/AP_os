import { describe, expect, it } from "vitest";
import { adaptPipelineRow } from "../../../../lib/adminDataAdapter.js";

describe("adaptPipelineRow reviewers + reco", () => {
  it("passes reviewers and reco through", () => {
    const row = adaptPipelineRow({
      id: "A", applicationId: "TIR-1", track: "tir", name: "Acme", status: "under_review",
      reviewer_score: 8, reviewers: { submitted: 2, assigned: 3 }, reco: { yes: 2, maybe: 0, no: 1 },
    });
    expect(row.reviewers).toEqual({ submitted: 2, assigned: 3 });
    expect(row.reco).toEqual({ yes: 2, maybe: 0, no: 1 });
  });
  it("defaults reviewers/reco to null when absent", () => {
    const row = adaptPipelineRow({ id: "A", applicationId: "TIR-1", track: "tir", status: "submitted" });
    expect(row.reviewers).toBeNull();
    expect(row.reco).toBeNull();
  });
});
