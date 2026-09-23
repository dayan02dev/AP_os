import { describe, expect, it } from "vitest";
import { JURY_PORTAL_ENABLED, landingPathFor } from "../landing.js";

describe("landingPathFor — Jury Portal closed for this round", () => {
  it("the flag is off", () => {
    expect(JURY_PORTAL_ENABLED).toBe(false);
  });

  it("a jury-only account falls through to /apply, never /jury", () => {
    expect(landingPathFor(["jury"])).toBe("/apply");
  });

  it("jury alongside another staff role lands on that portal", () => {
    expect(landingPathFor(["jury", "reviewer"])).toBe("/reviewer");
    expect(landingPathFor(["jury", "admin"])).toBe("/admin");
  });

  it("keeps the existing priority for everyone else", () => {
    expect(landingPathFor(["admin", "leadership"])).toBe("/leadership");
    expect(landingPathFor([])).toBe("/apply");
    expect(landingPathFor(undefined)).toBe("/apply");
  });
});
