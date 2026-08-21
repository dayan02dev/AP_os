import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

const SHORTLISTED = [
  { id: "s1", track: "tir", name: "Signed App", domain: "AI", ai: { overall: 8.1 },
    founders: ["F1"], applicationId: "TIR-1", gate2_decision: null },
  { id: "s2", track: "tir", name: "Pending App", domain: "AI", ai: { overall: 7.0 },
    founders: ["F2"], applicationId: "TIR-2", gate2_decision: null },
  // VIP rows, needed to make the decision+track composition test
  // discriminating (fix round 1): a fixture that is all-TIR cannot tell
  // "filters compose with AND" apart from "the track filter alone emptied
  // the result", because either way the intersection comes up empty.
  { id: "v1", track: "sip", name: "VIP Signed App", domain: "Robotics", ai: { overall: 8.5 },
    founders: ["V1"], applicationId: "SIP-1", gate2_decision: null },
  { id: "v2", track: "sip", name: "VIP Pending App", domain: "Robotics", ai: { overall: 7.5 },
    founders: ["V2"], applicationId: "SIP-2", gate2_decision: null },
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
        data: { documents: [], byKey: {
          "tir:s1": { file_name: "m.pdf", signed: true,
            signer_name: "A", signed_at: "2026-08-01T00:00:00Z" },
          "sip:v1": { file_name: "vip.pdf", signed: true,
            signer_name: "B", signed_at: "2026-08-02T00:00:00Z" },
        } },
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
    // 4 shortlisted (s1, s2, v1, v2) + 1 gate-2 reject (g2) = 5
    expect(await screen.findByText("5 of 5")).toBeInTheDocument();
  });
});

describe("AdminSelectedApplications — decision presentation", () => {
  it("marks each row with its decision chip", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.getByTestId("decision-s1").textContent).toBe("ACCEPTED");
    expect(screen.getByTestId("decision-s2").textContent).toBe("PENDING");
    expect(screen.getByTestId("decision-g2").textContent).toBe("REJECTED");
  });

  it("tints the row by decision", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(screen.getByTestId("row-s1").className).toContain("adm-row-accepted");
    expect(screen.getByTestId("row-g2").className).toContain("adm-row-rejected");
    expect(screen.getByTestId("row-s2").className).not.toContain("adm-row-");
  });

  it("narrows to a single decision category", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    fireEvent.click(screen.getByRole("button", { name: "Rejected" }));
    expect(screen.getByText("Gate2 Reject")).toBeInTheDocument();
    expect(screen.queryByText("Signed App")).toBeNull();
    expect(screen.queryByText("Pending App")).toBeNull();
  });

  it("composes the decision filter with the track filter", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    fireEvent.click(screen.getByRole("button", { name: "VIP" }));
    // VIP Signed App is both VIP and accepted — it survives the
    // intersection of the two filters.
    expect(screen.getByText("VIP Signed App")).toBeInTheDocument();
    // VIP Pending App passes the track filter alone (it IS VIP) but must
    // still be excluded once the decision filter is applied too. This is
    // the half that actually proves AND-composition: a fixture where every
    // row is TIR can't tell "the filters compose" apart from "the track
    // filter alone emptied the result" — both look like an empty screen.
    expect(screen.queryByText("VIP Pending App")).toBeNull();
    // A TIR row is excluded by the track filter regardless of decision.
    expect(screen.queryByText("Signed App")).toBeNull();
  });

  it("does not offer Reject on an already-rejected row", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    const row = screen.getByTestId("row-g2");
    // RULING 2: substring-matching row.textContent for "Reject" is fragile —
    // it only passes today because the chip renders "REJECTED" in caps, which
    // does not contain "Reject". Assert on the button itself instead.
    expect(within(row).queryByRole("button", { name: "Reject" })).toBeNull();
    const approveBtn = within(row).getByRole("button", { name: /approve/i });
    const memoBtn = within(row).getByRole("button", { name: /memo/i });
    expect(approveBtn).toBeDisabled();
    expect(memoBtn).toBeDisabled();
  });
});

describe("AdminSelectedApplications — shared toolbar", () => {
  it("uses the shared filter-area shell rather than a hand-rolled row", async () => {
    const { container } = render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    expect(container.querySelector(".lp-filter-area")).toBeTruthy();
    expect(container.querySelector(".lp-filter-row--search")).toBeTruthy();
  });

  it("styles its track switcher from the shared class, with no inline overrides", async () => {
    render(<AdminSelectedApplications />);
    await screen.findByText("Gate2 Reject");
    const tir = screen.getByRole("button", { name: "TIR" });
    // An inline background/border is what made this render as a grey square
    // while AdminPipeline's identical control rendered as a blue pill.
    expect(tir.getAttribute("style")).toBeNull();
    expect(tir.className).toContain("lp-track-btn");
  });
});
