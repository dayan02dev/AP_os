import { describe, it, expect } from "vitest";
import { misEmptyCopy, misEmptyReason } from "../misEmptyState.js";

const period = (over = {}) => ({
  period_key: "2026-06", label: "June 2026", status: "draft",
  due_date: "2026-07-05", overdue: false, ...over,
});

describe("misEmptyReason", () => {
  it("returns null when at least one period is submitted (not empty)", () => {
    expect(misEmptyReason([period({ status: "submitted" })])).toBeNull();
  });
  it("state 6 — not due yet: zero submitted, zero overdue", () => {
    const r = misEmptyReason([period({ due_date: "2026-07-05", overdue: false })]);
    expect(r).toEqual({ cause: "not_due_yet", due_date: "2026-07-05", due_label: "June 2026" });
  });
  it("state 7 — overdue backlog: zero submitted, N overdue, names the OLDEST", () => {
    const r = misEmptyReason([
      period({ period_key: "2026-04", label: "April 2026", due_date: "2026-05-05", overdue: true }),
      period({ period_key: "2026-05", label: "May 2026", due_date: "2026-06-05", overdue: true }),
    ]);
    expect(r).toEqual({ cause: "overdue_backlog", count: 2, oldest_label: "April 2026", oldest_due: "2026-05-05" });
  });
  it("mixes an overdue backlog with a not-yet-due period: counts only the overdue ones", () => {
    const r = misEmptyReason([
      period({ period_key: "2026-04", label: "April 2026", due_date: "2026-05-05", overdue: true }),
      period({ period_key: "2026-06", label: "June 2026", due_date: "2026-07-05", overdue: false }),
    ]);
    expect(r).toEqual({ cause: "overdue_backlog", count: 1, oldest_label: "April 2026", oldest_due: "2026-05-05" });
  });
});

// misEmptyCopy lived in three files as three byte-identical copies until it
// was consolidated into the rollup module. The point of one definition is
// that the two causes stay distinguishable; these assert exactly that, so a
// future edit collapsing them back into one sentence fails loudly.
describe("misEmptyCopy", () => {
  it("returns null when there is no empty reason", () => {
    expect(misEmptyCopy(null)).toBeNull();
  });

  it("names the backlog size and the oldest period when periods are overdue", () => {
    const copy = misEmptyCopy({
      cause: "overdue_backlog", count: 3,
      oldest_label: "May 2026", oldest_due: "2026-06-10",
    });
    expect(copy).toContain("3 period(s) are overdue");
    expect(copy).toContain("May 2026");
    expect(copy).toContain("2026-06-10");
  });

  it("says when the first report is due when nothing is overdue yet", () => {
    const copy = misEmptyCopy({ cause: "not_due_yet", due_date: "2026-09-10" });
    expect(copy).toContain("first one is due 2026-09-10");
    expect(copy).not.toContain("overdue");
  });

  it("gives the two causes genuinely different copy", () => {
    const backlog = misEmptyCopy({
      cause: "overdue_backlog", count: 2,
      oldest_label: "May 2026", oldest_due: "2026-06-10",
    });
    const notDue = misEmptyCopy({ cause: "not_due_yet", due_date: "2026-09-10" });
    expect(backlog).not.toEqual(notDue);
  });
});
