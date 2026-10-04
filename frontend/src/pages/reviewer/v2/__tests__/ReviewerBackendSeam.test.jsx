// Seam: every adminDecision bucket backend reviewer_query._admin_decision can
// return (contract C5) has its own label — none falls back to "Awaiting admin".
import { describe, expect, it } from "vitest";
import { DECISION_LABEL } from "../ReviewerHistory.jsx";

const BACKEND_BUCKETS = ["pending", "gate1_selected", "gate1_rejected", "final_selected",
  "final_rejected", "offered", "onboarded"];

describe("reviewer history ↔ backend adminDecision buckets", () => {
  it("labels every bucket", () => {
    for (const b of BACKEND_BUCKETS) expect(DECISION_LABEL[b]).toBeTruthy();
  });
});
