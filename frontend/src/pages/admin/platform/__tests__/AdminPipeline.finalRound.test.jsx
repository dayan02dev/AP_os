import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Rejected tab: apps rejected in the FINAL selection round (Reject on the
// Accepted tab → gate2_decision 'rejected') render red with a tag; gate-1
// rejects stay plain. Other AdminPipeline tabs never show the marker.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "pipeline") {
      return {
        data: { startups: [
          { id: "g1", track: "tir", nativeTrack: "tir", name: "Gate One Reject",
            chip: "REJECTED", domain: "AI", ai: {}, batches: [], gate2_decision: null },
          { id: "g2", track: "sip", nativeTrack: "sip", name: "Final Round Reject",
            chip: "REJECTED", domain: "AI", ai: {}, batches: [], gate2_decision: "rejected" },
        ], total: 2 },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    return { data: { batches: [] }, loading: false, error: null, reload: vi.fn() };
  },
  loadDetail: vi.fn(),
}));

import { AdminPipeline } from "../screens/AdminPipeline";

const renderRejected = () => render(
  <AdminPipeline goDetail={() => {}} readOnly baseFilter={{ status: "rejected" }}
    heading="Rejected applications" scopeKey="rejected" />,
);

describe("AdminPipeline — final-round rejects in the Rejected tab", () => {
  beforeEach(() => { sessionStorage.clear(); });

  it("paints final-round rejects red with a FINAL ROUND tag", () => {
    renderRejected();
    const row = screen.getByTestId("pipeline-row-g2");
    expect(row.className).toContain("adm-row-rejected");
    expect(row.textContent).toContain("FINAL ROUND");
  });

  it("leaves gate-1 rejects plain", () => {
    renderRejected();
    const row = screen.getByTestId("pipeline-row-g1");
    expect(row.className).not.toContain("adm-row-rejected");
    expect(row.textContent).not.toContain("FINAL ROUND");
  });

  it("explains the red rows in a legend", () => {
    renderRejected();
    const legend = screen.getByTestId("final-round-legend");
    expect(legend.textContent).toMatch(/rejected in the final selection round/i);
    expect(legend.textContent).toContain("1 so far");
  });

  it("can narrow to final-round rejects only", () => {
    renderRejected();
    fireEvent.click(screen.getByRole("button", { name: "Final round only" }));
    expect(screen.getByText("Final Round Reject")).toBeTruthy();
    expect(screen.queryByText("Gate One Reject")).toBeNull();
  });

  it("does not mark rows on other tabs", () => {
    render(<AdminPipeline goDetail={() => {}} baseFilter={{ exclude_status: "rejected,jury_review" }}
      scopeKey="applications" />);
    expect(screen.queryByTestId("final-round-legend")).toBeNull();
    expect(screen.getByTestId("pipeline-row-g2").className).not.toContain("adm-row-rejected");
    expect(screen.queryByText("FINAL ROUND")).toBeNull();
  });
});
