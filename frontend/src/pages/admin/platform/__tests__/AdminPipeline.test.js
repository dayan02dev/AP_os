import { describe, expect, it } from "vitest";

import { buildPipelineCsv } from "../AdminPipeline.jsx";

describe("buildPipelineCsv", () => {
  it("emits a header row even with no data", () => {
    const csv = buildPipelineCsv([]);
    const [header] = csv.split("\r\n");
    expect(header).toBe(
      "ID,Track,Name,Founder,Industry,Stage,AI Score,Status,Decision,Batch,Submitted",
    );
  });

  it("maps a row's fields, uppercases the track, and formats the score", () => {
    const csv = buildPipelineCsv([
      {
        applicationId: "TIR-00001",
        track: "tir",
        name: "Acme",
        founder: "Asha",
        industry: "Robotics",
        stage: "Pilot",
        ai_score_overall: 8.25,
        status: "under_review",
        decision: "shortlisted",
        batch: "Batch A",
        submitted_at: "2026-05-01",
      },
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe(
      "TIR-00001,TIR,Acme,Asha,Robotics,Pilot,8.3,Under Review,Shortlisted,Batch A,2026-05-01",
    );
  });

  it("guards nulls/missing fields and blanks a missing score", () => {
    const csv = buildPipelineCsv([
      { track: "sip", id: 42, name: "Beta", ai_score_overall: null },
    ]);
    const [, row] = csv.split("\r\n");
    // ID falls back to id, score/decision/batch blank, track uppercased to SIP.
    expect(row).toBe("42,SIP,Beta,,,,,,,,");
  });

  it("quotes cells that contain commas or quotes", () => {
    const csv = buildPipelineCsv([
      { applicationId: "X", track: "tir", name: 'Foo, "Bar"', founder: "Z" },
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toContain('"Foo, ""Bar"""');
  });
});
