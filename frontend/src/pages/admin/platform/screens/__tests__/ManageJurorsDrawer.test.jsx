import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/leadershipApi", () => ({
  leadershipApi: { assignJurors: vi.fn().mockResolvedValue({ results: [{ status: "assigned" }] }),
                   unassignJuror: vi.fn() },
}));
vi.mock("../../../../../lib/adminPlatformApi", () => ({ adminPlatformApi: {} }));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { leadershipApi } from "../../../../../lib/leadershipApi";
import { ManageJurorsDrawer } from "../ManageJurorsDrawer";

const JUROR = { id: "j1", name: "Dr. Iyer", domain: "Robotics" };
const SUG_A = { id: "app-a", track: "tir", name: "MedAtlas", domain: "Health",
                chip: "JURY REVIEW", recommendation: { score: 92 } };
const SUG_B = { id: "app-b", track: "tir", name: "Biosensors", domain: "Health",
                chip: "JURY REVIEW", recommendation: { score: 88 } };

function setup() {
  useAdminData.mockImplementation((kind) => {
    if (kind === "jurorApplications")
      return { data: { applications: [] }, loading: false, error: null, reload: vi.fn() };
    if (kind === "pipeline")
      return { data: { startups: [SUG_A, SUG_B] }, loading: false, error: null, reload: vi.fn() };
    return { data: null, loading: false, error: null, reload: vi.fn() };
  });
}

describe("ManageJurorsDrawer — suggest-then-confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows AI suggestions pre-checked and no auto-assign button", () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByText(/Suggested matches/i)).toBeTruthy();
    expect(screen.queryByText(/Auto-assign matches/i)).toBeNull();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(2);
    expect(boxes.every(b => b.checked)).toBe(true);
    expect(screen.getByText(/Assign selected \(2\)/i)).toBeTruthy();
  });

  it("assigns only the checked suggestions", async () => {
    setup();
    render(<ManageJurorsDrawer juror={JUROR} onClose={() => {}} onChanged={() => {}} />);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]);                 // uncheck Biosensors
    expect(screen.getByText(/Assign selected \(1\)/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Assign selected/i));
    await waitFor(() => expect(leadershipApi.assignJurors).toHaveBeenCalledTimes(1));
    expect(leadershipApi.assignJurors).toHaveBeenCalledWith("app-a", "tir", { juror_user_ids: ["j1"] });
  });
});
