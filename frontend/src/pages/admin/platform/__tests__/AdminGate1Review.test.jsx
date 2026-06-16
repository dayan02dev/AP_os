import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import {
  canSubmitDecision,
  decisionNeedsRationale,
  buildBulkItems,
  partitionByCutoff,
  summarizeBulkResults,
} from "../screens/AdminGate1.jsx";

// ── Smoke test: AdminGate1 mounts and shows the variant tabs ────────────────
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: () => ({ data: { startups: [], total: 0 }, loading: false, error: null, reload: vi.fn() }),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn() },
}));
vi.mock("../shell/osAtoms", () => ({
  PageHead: ({ eyebrow, title }) => <div>{eyebrow} {title}</div>,
  Chip: ({ children }) => <span>{children}</span>,
  FlagDot: () => null,
}));
vi.mock("../screens/ComparativeReviewModel", () => ({
  ComparativeReviewModel: () => null,
}));
vi.mock("../ui.jsx", () => ({
  LoadingState: ({ label }) => <div>{label}</div>,
  ErrorState:   ({ error }) => <div>{String(error)}</div>,
  EmptyState:   ({ label }) => <div>{label}</div>,
}));

// Default import
import AdminGate1 from "../screens/AdminGate1.jsx";

describe("AdminGate1 smoke", () => {
  it("renders the 4 variant tabs", () => {
    render(<AdminGate1 goDetail={() => {}} />);
    expect(screen.getByText(/A · Status/i)).toBeTruthy();
    expect(screen.getByText(/B · Cutoff slider/i)).toBeTruthy();
    expect(screen.getByText(/C · Batch decision/i)).toBeTruthy();
    expect(screen.getByText(/D · My history/i)).toBeTruthy();
  });

  it("shows empty state when no evaluated apps", () => {
    render(<AdminGate1 goDetail={() => {}} />);
    expect(screen.getByText(/No evaluated applications/i)).toBeTruthy();
  });
});

describe("canSubmitDecision — rationale gate", () => {
  it("requires a chosen decision", () => {
    expect(canSubmitDecision(null, "")).toBe(false);
    expect(canSubmitDecision("", "anything")).toBe(false);
  });

  it("lets shortlist submit without a rationale", () => {
    expect(canSubmitDecision("shortlisted", "")).toBe(true);
    expect(canSubmitDecision("shortlisted", "   ")).toBe(true);
  });

  it("requires a non-blank rationale for hold / reject / waitlist", () => {
    for (const d of ["on_hold", "rejected", "waitlisted"]) {
      expect(canSubmitDecision(d, "")).toBe(false);
      expect(canSubmitDecision(d, "   ")).toBe(false);
      expect(canSubmitDecision(d, "not a fit")).toBe(true);
    }
  });

  it("rejects an unknown decision id", () => {
    expect(canSubmitDecision("approved", "x")).toBe(false);
  });
});

describe("decisionNeedsRationale", () => {
  it("is false only for shortlist", () => {
    expect(decisionNeedsRationale("shortlisted")).toBe(false);
    expect(decisionNeedsRationale("on_hold")).toBe(true);
    expect(decisionNeedsRationale("rejected")).toBe(true);
    expect(decisionNeedsRationale("waitlisted")).toBe(true);
    expect(decisionNeedsRationale("nope")).toBe(false);
  });
});

describe("buildBulkItems", () => {
  const rows = [
    { id: "a1", track: "tir" },
    { id: "a2", track: "sip" },
    { id: "a3", track: "tir" },
  ];

  it("builds one item per drafted decision and attaches rationale", () => {
    const { items, missingRationale } = buildBulkItems(
      { a1: "shortlisted", a2: "rejected" },
      rows,
      () => "shared reason",
    );
    expect(missingRationale).toEqual([]);
    expect(items).toContainEqual({
      track: "tir",
      application_id: "a1",
      decision: "shortlisted",
      rationale: "shared reason",
    });
    expect(items).toContainEqual({
      track: "sip",
      application_id: "a2",
      decision: "rejected",
      rationale: "shared reason",
    });
  });

  it("shortlist omits rationale when blank, others flag missing", () => {
    const { items, missingRationale } = buildBulkItems(
      { a1: "shortlisted", a2: "rejected", a3: "on_hold" },
      rows,
      () => "",
    );
    // shortlist is allowed without rationale (rationale -> undefined)
    expect(items).toEqual([
      { track: "tir", application_id: "a1", decision: "shortlisted", rationale: undefined },
    ]);
    expect(missingRationale.sort()).toEqual(["a2", "a3"]);
  });

  it("skips rows with no draft, falsy drafts, and unknown ids", () => {
    const { items } = buildBulkItems(
      { a1: "shortlisted", a2: null, ghost: "rejected" },
      rows,
      () => "x",
    );
    expect(items).toHaveLength(1);
    expect(items[0].application_id).toBe("a1");
  });

  it("matches numeric-keyed drafts against numeric row ids", () => {
    const numRows = [{ id: 42, track: "tir" }];
    const { items } = buildBulkItems({ 42: "shortlisted" }, numRows, () => "");
    expect(items).toEqual([
      { track: "tir", application_id: 42, decision: "shortlisted", rationale: undefined },
    ]);
  });

  it("passes the decision into the rationale callback", () => {
    const { items } = buildBulkItems(
      { a1: "shortlisted", a2: "rejected" },
      rows,
      (_row, decision) => (decision === "rejected" ? "below cutoff" : ""),
    );
    const reject = items.find((i) => i.decision === "rejected");
    expect(reject.rationale).toBe("below cutoff");
    const short = items.find((i) => i.decision === "shortlisted");
    expect(short.rationale).toBeUndefined();
  });
});

describe("partitionByCutoff", () => {
  const rows = [
    { id: "a", ai_score_overall: 9 },
    { id: "b", ai_score_overall: 7 },
    { id: "c", ai_score_overall: 5 },
    { id: "d", ai_score_overall: null },
  ];

  it("splits at the cutoff (>= goes above)", () => {
    const { above, below } = partitionByCutoff(rows, 7, new Set());
    expect(above.map((r) => r.id)).toEqual(["a", "b"]);
    expect(below.map((r) => r.id).sort()).toEqual(["c", "d"]);
  });

  it("treats a missing score as below cutoff", () => {
    const { below } = partitionByCutoff(rows, 0, new Set());
    expect(below.map((r) => r.id)).toEqual(["d"]);
  });

  it("pulls overridden ids into their own bucket", () => {
    const { above, below, overridden } = partitionByCutoff(
      rows,
      7,
      new Set(["a"]),
    );
    expect(overridden.map((r) => r.id)).toEqual(["a"]);
    expect(above.map((r) => r.id)).toEqual(["b"]);
    expect(below.map((r) => r.id).sort()).toEqual(["c", "d"]);
  });
});

describe("summarizeBulkResults", () => {
  it("counts decided as success and collects failures", () => {
    const { ok, failures } = summarizeBulkResults({
      results: [
        { application_id: "a", status: "decided" },
        { application_id: "b", status: "rationale_required" },
        { application_id: "c", status: "illegal_transition" },
      ],
    });
    expect(ok).toBe(1);
    expect(failures).toEqual([
      { id: "b", status: "rationale_required" },
      { id: "c", status: "illegal_transition" },
    ]);
  });

  it("handles an empty / missing response", () => {
    expect(summarizeBulkResults(undefined)).toEqual({ ok: 0, failures: [] });
    expect(summarizeBulkResults({ results: [] })).toEqual({ ok: 0, failures: [] });
  });
});
