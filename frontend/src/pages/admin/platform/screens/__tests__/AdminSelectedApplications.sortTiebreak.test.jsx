// Regression guard for the same-bucket sort tie-break: rows sharing a
// decision bucket (pending/accepted/rejected) must additionally sort
// newest-`sub`-first within that bucket.
//
// Fixture is adapter-shaped: adaptPipelineRow (adminDataAdapter.js) truncates
// the raw submission timestamp into `sub` (YYYY-MM-DD) — pipeline rows never
// carry a `submitted_at` field. A fixture using `submitted_at` would not
// reflect what the screen actually receives, and would let a tie-break that
// reads the wrong field pass vacuously.
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Both rows are `pending` (gate2_decision null, no signed memo) — same
// bucket — so this exercises the tie-break, not the bucket ordering.
// Deliberately fixture-ordered OLDER-then-NEWER: a dead tie-break (always
// returns 0) leaves a stable sort in THIS insertion order, so the test only
// passes if the tie-break actually reorders by `sub` descending.
const OLDER = {
  id: "o1", track: "tir", name: "Older Pending", domain: "AI", ai: { overall: 6.0 },
  founders: ["F1"], applicationId: "TIR-10", gate2_decision: null, sub: "2026-08-01",
};
const NEWER = {
  id: "n1", track: "tir", name: "Newer Pending", domain: "AI", ai: { overall: 7.0 },
  founders: ["F2"], applicationId: "TIR-11", gate2_decision: null, sub: "2026-08-20",
};

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => {
    if (kind === "icDocuments") {
      return { data: { documents: [], byKey: {} }, loading: false, error: null, reload: vi.fn() };
    }
    const rows = params?.status === "rejected" ? [] : [OLDER, NEWER];
    return { data: { startups: rows, total: rows.length }, loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminSelectedApplications } from "../AdminSelectedApplications";

describe("AdminSelectedApplications — same-bucket sort tie-break", () => {
  it("orders two pending rows newest-`sub`-first", () => {
    const { container } = render(<AdminSelectedApplications />);
    const names = Array.from(container.querySelectorAll("tbody tr td:first-child .startup"))
      .map((el) => el.textContent);
    const olderIdx = names.findIndex((t) => t.includes("Older Pending"));
    const newerIdx = names.findIndex((t) => t.includes("Newer Pending"));
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});
