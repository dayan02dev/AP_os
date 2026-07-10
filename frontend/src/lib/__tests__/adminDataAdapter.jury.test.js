import { describe, it, expect } from "vitest";
import { adaptPipelineRow, adaptJuror, adaptJurorApplication } from "../adminDataAdapter";

describe("adaptPipelineRow — jury v2 fields", () => {
  const row = { id: "u1", track: "tir", status: "jury_review" };

  it("passes through jury_assigned + jury_assigned_names", () => {
    const s = adaptPipelineRow({ ...row, jury_assigned: 2, jury_assigned_names: ["Ravi", "Meena"] });
    expect(s.jury_assigned).toBe(2);
    expect(s.jury_assigned_names).toEqual(["Ravi", "Meena"]);
  });

  it("passes through picked_by", () => {
    const pickedBy = [{ juror_user_id: "j1", name: "Ravi", note: "strong fit" }];
    expect(adaptPipelineRow({ ...row, picked_by: pickedBy }).picked_by).toEqual(pickedBy);
  });

  it("passes through picks_ready as a boolean", () => {
    expect(adaptPipelineRow({ ...row, picks_ready: true }).picks_ready).toBe(true);
    expect(adaptPipelineRow({ ...row, picks_ready: false }).picks_ready).toBe(false);
    expect(adaptPipelineRow(row).picks_ready).toBe(false);
  });

  it("passes through recommendation", () => {
    const rec = { score: 0.82, reason: "domain match" };
    expect(adaptPipelineRow({ ...row, recommendation: rec }).recommendation).toEqual(rec);
    expect(adaptPipelineRow(row).recommendation).toBeNull();
  });

  it("passes through gate2_decision", () => {
    expect(adaptPipelineRow({ ...row, gate2_decision: "offered" }).gate2_decision).toBe("offered");
    expect(adaptPipelineRow(row).gate2_decision).toBeNull();
  });

  it("defaults jury fields when absent", () => {
    const s = adaptPipelineRow(row);
    expect(s.jury_assigned).toBe(0);
    expect(s.jury_assigned_names).toEqual([]);
    expect(s.picked_by).toEqual([]);
  });
});

describe("adaptJuror", () => {
  it("maps a jury roster row", () => {
    const r = adaptJuror({
      user_id: "j1", name: "Ravi Kumar", email: "ravi@x.in",
      weight: 2.0, domains: ["Robotics", "IoT"],
      enrichmentStatus: "done", picks: "2 / 3", picksSubmitted: 2,
      assigned: 5, lastActivity: "2026-07-01T00:00:00Z",
      invite: { status: "accepted" },
    });
    expect(r).toMatchObject({
      id: "j1", name: "Ravi Kumar", email: "ravi@x.in",
      weight: 2.0, domains: ["Robotics", "IoT"], domain: "Robotics, IoT",
      enrichmentStatus: "done", picks: "2 / 3", picksSubmitted: 2,
      assigned: 5, last: "2026-07-01T00:00:00Z",
      invite: { status: "accepted" },
    });
  });

  it("defaults absent fields", () => {
    const r = adaptJuror({ user_id: "j2", name: "X" });
    expect(r.weight).toBe(1.0);
    expect(r.domains).toEqual([]);
    expect(r.domain).toBe("");
    expect(r.enrichmentStatus).toBe("pending");
    expect(r.picks).toBe("0 / 3");
    expect(r.picksSubmitted).toBe(0);
    expect(r.assigned).toBe(0);
    expect(r.invite).toBeNull();
  });
});

describe("adaptJurorApplication", () => {
  it("maps a juror-assigned application row", () => {
    const a = adaptJurorApplication({
      id: "app-1", track: "tir", project: "Karkhana Robotics",
      industry: "Robotics & Automation", status: "jury_review", picked: true,
    });
    expect(a).toEqual({
      id: "app-1", track: "tir", project: "Karkhana Robotics",
      industry: "Robotics & Automation", status: "jury_review", picked: true,
    });
  });

  it("defaults picked to false when absent", () => {
    expect(adaptJurorApplication({ id: "app-2", track: "sip" }).picked).toBe(false);
  });
});
