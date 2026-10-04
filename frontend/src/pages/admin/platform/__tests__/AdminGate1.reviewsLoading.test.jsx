// Variant A: while the app's reviews are still loading, the consensus card
// shows a loading state — never "No reviewer evaluations submitted yet" next
// to a weighted reviewer score.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn(), loadDetail: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { decide: vi.fn(), bulkDecide: vi.fn(), getPipeline: vi.fn() },
}));
vi.mock("../screens/ApplicationSummaryCard", () => ({ default: () => <div>SUMMARY</div> }));

import AdminGate1 from "../screens/AdminGate1.jsx";
import { useAdminData, loadDetail } from "../../../../hooks/useAdminData";

const APP = { id: "v1", track: "sip", name: "VIP-26710 App", domain: "X", flags: [], batches: [],
  ai: { overall: 7.1 }, rev: { overall: 6.6 }, chip: "EVALUATED" };

function mount() {
  useAdminData.mockImplementation(() => ({ data: { startups: [APP] }, loading: false, error: null, reload: vi.fn() }));
  return render(<AdminGate1 goDetail={() => {}} />);
}

describe("Variant A reviewer consensus loading", () => {
  it("shows a loading state until the reviews arrive", async () => {
    let resolve;
    loadDetail.mockReturnValue(new Promise((r) => { resolve = r; }));
    mount();
    expect(await screen.findByText(/Loading reviewer evaluations/i)).toBeTruthy();
    expect(screen.queryByText(/No reviewer evaluations submitted yet/)).toBeNull();
    resolve({ reviews: [{ reviewerId: "r1", reviewerName: "Ashish", problem: 6, solution: 7,
      tech: 6, founders: 7, commit: 6, overall: 6.5, reco: "yes", flags: [] }] });
    await waitFor(() => expect(screen.getByText("Ashish")).toBeTruthy());
    expect(screen.queryByText(/Loading reviewer evaluations/i)).toBeNull();
  });
  it("shows the empty message only once loading finished with no reviews", async () => {
    loadDetail.mockResolvedValue({ reviews: [] });
    mount();
    expect(await screen.findByText(/No reviewer evaluations submitted yet/)).toBeTruthy();
  });
});
