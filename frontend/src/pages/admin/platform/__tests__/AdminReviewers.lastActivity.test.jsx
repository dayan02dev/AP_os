import { describe, expect, it } from "vitest";
import { formatLastActivity } from "../screens/AdminReviewers";

describe("formatLastActivity", () => {
  it("formats an ISO timestamp as absolute IST date + time", () => {
    // 2026-06-29T05:09:07Z == 10:39 IST (UTC+5:30)
    const out = formatLastActivity("2026-06-29T05:09:07.459686+00:00");
    expect(out).toMatch(/29 Jun 2026/);
    expect(out).toMatch(/10:39\s?AM/);
  });
  it("passes a non-ISO string through unchanged", () => {
    expect(formatLastActivity("2h ago")).toBe("2h ago");
  });
  it("returns an em dash for empty input", () => {
    expect(formatLastActivity("")).toBe("—");
    expect(formatLastActivity(null)).toBe("—");
  });
});
