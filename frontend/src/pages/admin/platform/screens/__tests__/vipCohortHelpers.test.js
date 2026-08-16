// vipCohortHelpers — pure functions shared by the AIR queue/detail and MIS
// matrix/period screens: error-code -> real copy (the backend ships
// `detail.code` with no `message`, so api.js's ApiError.message falls back to
// the bare "Request failed" the task explicitly calls out), date formatting,
// choice-field label lookup, and the entries-catalog grouping that finds a
// "SECTION_EXTRA_ENTRIES"-style secondary table (e.g. quarterly's
// next_milestones riding under planned_vs_actual) purely from key order,
// with no hardcoded backend knowledge to drift out of sync.

import { describe, it, expect } from "vitest";
import {
  vipErrorInfo,
  formatDateTime,
  formatDate,
  levelText,
  fieldValueText,
  groupExtraEntries,
  humanize,
} from "../vipCohortHelpers.js";

describe("vipErrorInfo — maps backend detail.code to real copy", () => {
  it("gives assessment_not_found its own message", () => {
    const info = vipErrorInfo({ code: "assessment_not_found", details: {} });
    expect(info.message).toMatch(/could not be found/i);
  });

  it("distinguishes air_not_open_for_verification by the round's actual status — draft", () => {
    const info = vipErrorInfo({ code: "air_not_open_for_verification", details: { status: "draft" } });
    expect(info.message).toMatch(/hasn.t been submitted/i);
  });

  it("distinguishes air_not_open_for_verification by the round's actual status — verified", () => {
    const info = vipErrorInfo({ code: "air_not_open_for_verification", details: { status: "verified" } });
    expect(info.message).toMatch(/already.*verified/i);
  });

  it("names the claimed level on verified_level_out_of_range", () => {
    const info = vipErrorInfo({ code: "verified_level_out_of_range", details: { claimed_level: 5 } });
    expect(info.message).toContain("5");
    expect(info.message).toMatch(/claimed/i);
  });

  it("surfaces the blocking period on mis_later_period_submitted, structured for a link", () => {
    const info = vipErrorInfo({
      code: "mis_later_period_submitted",
      details: { period_key: "2026-07", label: "Jul 2026" },
    });
    expect(info.blockerPeriodKey).toBe("2026-07");
    expect(info.message).toContain("Jul 2026");
  });

  it("gives mis_not_submitted its own message, distinct from mis_later_period_submitted", () => {
    const info = vipErrorInfo({ code: "mis_not_submitted", details: {} });
    expect(info.message).toMatch(/already a draft/i);
    expect(info.blockerPeriodKey).toBeNull();
  });

  it("falls back to a real message (never the bare 'Request failed') for an unmapped code", () => {
    const info = vipErrorInfo({ code: "http_500", message: "Request failed", details: {} });
    expect(info.message).not.toBe("Request failed");
  });

  it("keeps a genuinely useful upstream message when one exists", () => {
    const info = vipErrorInfo({ code: "network_error", message: "Network error", details: {} });
    expect(info.message).toBe("Network error");
  });
});

describe("date formatting", () => {
  it("formats an ISO datetime", () => {
    expect(formatDateTime("2026-08-15T10:30:00Z")).not.toBe("2026-08-15T10:30:00Z");
    expect(formatDateTime("2026-08-15T10:30:00Z")).toMatch(/2026/);
  });
  it("renders a dash for a missing datetime", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
  it("formats a plain date", () => {
    expect(formatDate("2026-08-15")).toMatch(/2026/);
  });
  it("renders a dash for a missing date", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("levelText", () => {
  it("renders a dash for null (never verified / never claimed)", () => {
    expect(levelText(null)).toBe("—");
  });
  it("renders the AIR level otherwise", () => {
    expect(levelText(4)).toBe("AIR 4");
  });
});

describe("fieldValueText — entries-grid field rendering", () => {
  it("renders the human label for a choice field via option_labels", () => {
    const field = {
      key: "category", type: "choice",
      option_labels: [{ value: "investor_intros", label: "Investor intros" }],
    };
    expect(fieldValueText(field, "investor_intros")).toBe("Investor intros");
  });
  it("falls back to the raw value when no option_labels entry matches", () => {
    const field = { key: "severity", type: "choice", options: ["red", "amber"] };
    expect(fieldValueText(field, "red")).toBe("red");
  });
  it("renders Yes/No for a bool field", () => {
    const field = { key: "peer_reviewed", type: "bool" };
    expect(fieldValueText(field, true)).toBe("Yes");
    expect(fieldValueText(field, false)).toBe("No");
  });
  it("renders a dash for a blank value, not an empty string", () => {
    const field = { key: "notes", type: "text" };
    expect(fieldValueText(field, null)).toBe("—");
    expect(fieldValueText(field, "")).toBe("—");
  });
});

describe("humanize", () => {
  it("turns a snake_case catalog key into a title", () => {
    expect(humanize("next_milestones")).toBe("Next milestones");
  });
});

describe("groupExtraEntries — finds a secondary entries table by key order alone", () => {
  it("attaches next_milestones to planned_vs_actual without any hardcoded map", () => {
    const catalog = {
      sections: [
        { id: "glance", type: "narrative" },
        { id: "planned_vs_actual", type: "entries" },
      ],
      entry_fields: {
        planned_vs_actual: [{ key: "planned", label: "Planned", type: "text" }],
        next_milestones: [{ key: "milestone", label: "Milestone", type: "text" }],
      },
    };
    const extras = groupExtraEntries(catalog);
    expect(extras.planned_vs_actual).toEqual(["next_milestones"]);
  });

  it("produces no extras when every entry_fields key has its own section", () => {
    const catalog = {
      sections: [{ id: "milestones", type: "entries" }],
      entry_fields: { milestones: [{ key: "milestone", label: "Milestone", type: "text" }] },
    };
    expect(groupExtraEntries(catalog)).toEqual({});
  });
});
