import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const SHORTLISTED = [
  { id: "s1", track: "tir", name: "Signed App", domain: "AI", ai: { overall: 8.1 },
    founders: ["F1"], applicationId: "TIR-1", gate2_decision: null },
  { id: "s2", track: "tir", name: "Pending App", domain: "AI", ai: { overall: 7.0 },
    founders: ["F2"], applicationId: "TIR-2", gate2_decision: null },
];

// Two rejected rows with DIFFERENT causes. g1 was rejected at gate 1 and never
// reached this tab; g2 was rejected here. Only g2 may appear. A fixture
// without g1 would let a `status === 'rejected'` implementation pass.
const REJECTED = [
  { id: "g1", track: "tir", name: "Gate1 Reject", domain: "AI", ai: { overall: 4.0 },
    founders: ["F3"], applicationId: "TIR-3", gate2_decision: null },
  { id: "g2", track: "tir", name: "Gate2 Reject", domain: "AI", ai: { overall: 6.0 },
    founders: ["F4"], applicationId: "TIR-4", gate2_decision: "rejected" },
];

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => {
    if (kind === "icDocuments") {
      return {
        data: { documents: [], byKey: { "tir:s1": { file_name: "m.pdf", signed: true,
          signer_name: "A", signed_at: "2026-08-01T00:00:00Z" } } },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    const rows = params?.status === "rejected" ? REJECTED : SHORTLISTED;
    return { data: { startups: rows, total: rows.length }, loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminSelectedApplications, decisionStateOf } from "../AdminSelectedApplications";

describe("decisionStateOf", () => {
  it("is rejected when the gate-2 decision says so", () => {
    expect(decisionStateOf({ gate2_decision: "rejected" }, null)).toBe("rejected");
  });
  it("is accepted when the memo is signed", () => {
    expect(decisionStateOf({ gate2_decision: null }, { signed: true })).toBe("accepted");
  });
  it("is pending with an unsigned memo", () => {
    expect(decisionStateOf({ gate2_decision: null }, { signed: false })).toBe("pending");
  });
  it("is pending with no memo at all", () => {
    expect(decisionStateOf({ gate2_decision: null }, null)).toBe("pending");
  });
  it("prefers rejected over a signed memo", () => {
    expect(decisionStateOf({ gate2_decision: "rejected" }, { signed: true })).toBe("rejected");
  });
});

describe("AdminSelectedApplications — rejected rows return", () => {
  it("lists an application rejected at gate 2", async () => {
    render(<AdminSelectedApplications />);
    expect(await screen.findByText("Gate2 Reject")).toBeInTheDocument();
  });

  it("does NOT list an application rejected at gate 1", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.queryByText("Gate1 Reject")).toBeNull();
  });

  it("counts the merged list", async () => {
    render(<AdminSelectedApplications />);
    // 2 shortlisted + 1 gate-2 reject = 3
    expect(await screen.findByText("3 of 3")).toBeInTheDocument();
  });
});
