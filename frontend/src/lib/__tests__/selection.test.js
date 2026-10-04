import { describe, it, expect } from "vitest";
import { signedDocKeys, isSelected } from "../selection";
import { selectedCount } from "../adminBadges";

// Multi-memo rule (same as AdminSelectedApplications.decisionStateOf): an app is
// selected only when it has >=1 current IC document AND every current one is signed.
describe("signedDocKeys — every current doc must be signed", () => {
  const docs = [
    { track: "tir", application_id: "a", signed: true },
    { track: "tir", application_id: "a", signed: false },   // one unsigned → not selected
    { track: "tir", application_id: "b", signed: true },
    { track: "tir", application_id: "b", signed: true },
    { track: "tir", application_id: "c", signed: true, superseded_at: "2026-09-01" }, // retired
    { track: "tir", application_id: "c", signed: false },
    { track: "tir", application_id: "d", signed: true, superseded_at: "2026-09-01" }, // only retired docs
  ];

  it("keeps only apps whose current docs are all signed", () => {
    const keys = signedDocKeys(docs);
    expect(keys.has("tir:a")).toBe(false);
    expect(keys.has("tir:b")).toBe(true);
    expect(keys.has("tir:c")).toBe(false);
    expect(keys.has("tir:d")).toBe(false);
  });

  it("isSelected and selectedCount agree with the per-app rule", () => {
    const keys = signedDocKeys(docs);
    expect(isSelected({ status: "jury_review", nativeTrack: "tir", id: "a" }, keys)).toBe(false);
    expect(isSelected({ status: "jury_review", nativeTrack: "tir", id: "b" }, keys)).toBe(true);
    const rows = ["a", "b", "c", "d"].map((id) => ({ id, track: "tir", nativeTrack: "tir" }));
    expect(selectedCount(rows, docs)).toBe(1);
  });
});
