import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// One rejected row; useAdminData is mocked so no network is hit.
vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: (kind) => {
    if (kind === "pipeline") {
      return {
        data: { startups: [{
          id: "a1", applicationId: "TIR-1", name: "Proj A", founder: "F. Ounder",
          industry: "AI", stage: "Idea", ai_score_overall: 7, reviewer_score: null,
          status: "rejected", batch: "Batch A", flags: [], submitted_at: "2026-06-01",
        }], total: 1 },
        loading: false, error: null, reload: vi.fn(),
      };
    }
    if (kind === "batches") return { data: { batches: [] }, loading: false, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  },
}));

import { AdminPipeline } from "../screens/AdminPipeline";

describe("AdminPipeline read-only (Rejected tab)", () => {
  it("hides selection checkboxes + bulk Reject and shows the batch as text", () => {
    render(<AdminPipeline goDetail={() => {}} readOnly baseFilter={{ status: "rejected" }} heading="Rejected applications" />);
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(0);
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
    // batch rendered as static text, not a <select>
    expect(screen.getByText("Batch A")).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });
});
