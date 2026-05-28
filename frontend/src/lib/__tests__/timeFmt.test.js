import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fmtRelative } from "../timeFmt";

describe("fmtRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for under 60 seconds", () => {
    expect(fmtRelative("2026-05-20T11:59:30Z")).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(fmtRelative("2026-05-20T11:45:00Z")).toBe("15m ago");
  });

  it("returns hours for under a day", () => {
    expect(fmtRelative("2026-05-20T07:00:00Z")).toBe("5h ago");
  });

  it("returns days for under 30 days", () => {
    expect(fmtRelative("2026-05-15T12:00:00Z")).toBe("5d ago");
  });

  it("returns DD MMM YYYY for ≥ 30 days", () => {
    const out = fmtRelative("2026-03-01T12:00:00Z");
    // en-IN locale may render "01 Mar 2026" or "1 Mar 2026" depending on
    // browser implementation; accept either.
    expect(out).toMatch(/0?1 Mar 2026/);
  });

  it("returns '—' for null / undefined", () => {
    expect(fmtRelative(null)).toBe("—");
    expect(fmtRelative(undefined)).toBe("—");
  });

  it("returns '—' for unparseable input", () => {
    expect(fmtRelative("not-a-date")).toBe("—");
    expect(fmtRelative("")).toBe("—");
  });
});
