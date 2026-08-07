// Delete a reviewer / jury member from the admin rosters.
//
// The dangerous part of this feature is the CONFIRM step and the wiring: the
// backend permanently releases assignments, so a mis-fired click is expensive.
// These cover: the button exists where the admin expects it, nothing fires
// until the name is typed exactly, the right id is sent, and the result is
// reported back honestly (including "reviews kept", the reassurance that makes
// the action safe to take).

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: {
    deleteReviewer: vi.fn(),
    deleteJuror: vi.fn(),
    patchReviewer: vi.fn(),
    patchJuror: vi.fn(),
    enrichJuror: vi.fn().mockResolvedValue({}),
    recomputeRecommendations: vi.fn().mockResolvedValue({ queued: [] }),
    createJuryInvites: vi.fn(),
    assignBatchReviewers: vi.fn(),
    unassignBatchReviewer: vi.fn(),
  },
}));
vi.mock("../../../../../lib/adminApi", () => ({
  adminApi: { createUser: vi.fn(), listUsers: vi.fn() },
}));
vi.mock("../../../../../lib/leadershipApi", () => ({
  leadershipApi: { assignJurors: vi.fn(), unassignJuror: vi.fn() },
}));

import { useAdminData } from "../../../../../hooks/useAdminData";
import { adminPlatformApi } from "../../../../../lib/adminPlatformApi";
import { RemoveMemberDialog, removalSummary } from "../RemoveMemberDialog";
import { AdminReviewers } from "../AdminReviewers";
import { AdminJury } from "../AdminJury";

const REVIEWER = {
  id: "rev-1", name: "Abhijit Lele", email: "abhijit@example.com",
  weight: 1.0, domains: ["ai"], domain: "ai", batches: [{ name: "Batch A", count: 8 }],
  progress: "3 / 8", consistency: 0.8, last: "2026-08-01T10:00:00Z",
};
const JUROR = {
  id: "jur-1", name: "Udayan Pawar", email: "udayanpawar03+jury@gmail.com",
  weight: 1.0, domains: ["ai"], domain: "ai", enrichmentStatus: "done",
  picks: "0 / 3", picksSubmitted: 0, assigned: 2, last: null,
};

function mockAdminData({ reviewers = [], jurors = [], startups = [] } = {}) {
  useAdminData.mockImplementation((kind) => {
    const base = { loading: false, error: null, reload: vi.fn() };
    if (kind === "reviewers") return { ...base, data: { reviewers } };
    if (kind === "jurors") return { ...base, data: { jurors, pendingInvites: [] } };
    if (kind === "pipeline") return { ...base, data: { startups } };
    if (kind === "batches") return { ...base, data: { batches: [{ id: "b1", name: "Batch A" }] } };
    return { ...base, data: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminData();
});

// ── The confirm dialog itself ────────────────────────────────────────────

describe("RemoveMemberDialog", () => {
  const setup = (kind = "reviewer", onConfirm = vi.fn()) => {
    render(
      <RemoveMemberDialog
        kind={kind}
        member={{ id: "x", name: "Abhijit Lele", email: "a@b.com" }}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    return onConfirm;
  };

  it("keeps the destructive button disabled until the name is typed exactly", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Remove reviewer" });
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "Abhijit" } });
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "Abhijit Lele" } });
    expect(btn.disabled).toBe(false);
  });

  it("accepts the name case-insensitively (admins retype from the row)", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "abhijit lele" } });
    expect(screen.getByRole("button", { name: "Remove reviewer" }).disabled).toBe(false);
  });

  it("does not call onConfirm while the typed name is wrong", () => {
    const onConfirm = setup();
    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove reviewer" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("states that reviews are kept and the account survives", () => {
    setup("reviewer");
    expect(screen.getByText(/reviews, scores and recommendations are KEPT/i)).toBeTruthy();
    expect(screen.getByText(/sign-in account is not deleted/i)).toBeTruthy();
  });

  it("states the jury-specific effects", () => {
    setup("jury");
    expect(screen.getByText(/picks and AI recommendations are removed/i)).toBeTruthy();
    expect(screen.getByText(/invite is cleared/i)).toBeTruthy();
  });

  it("surfaces a backend failure instead of silently closing", async () => {
    const onConfirm = vi.fn().mockRejectedValue({ message: "boom" });
    setup("reviewer", onConfirm);
    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "Abhijit Lele" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove reviewer" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("boom"));
  });
});

describe("removalSummary", () => {
  it("reports released applications AND kept reviews for a reviewer", () => {
    const msg = removalSummary("reviewer", "Abhijit Lele",
      { assignments_removed: 141, reviews_kept: 12 });
    expect(msg).toContain("141 application(s) released");
    expect(msg).toContain("12 review(s) kept");
  });

  it("reports picks and the cleared invite for a juror", () => {
    const msg = removalSummary("jury", "Udayan",
      { assignments_removed: 2, picks_removed: 3, invite_removed: true });
    expect(msg).toContain("2 application(s) released");
    expect(msg).toContain("3 pick(s) cleared");
    expect(msg).toContain("invite cleared");
  });
});

// ── Reviewer roster wiring ───────────────────────────────────────────────

describe("AdminReviewers — delete", () => {
  beforeEach(() => mockAdminData({ reviewers: [REVIEWER] }));

  it("offers Delete reviewer from the Manage Applications drawer", async () => {
    render(<AdminReviewers />);
    fireEvent.click(screen.getByText("Manage"));
    await waitFor(() => expect(screen.getByText("Delete reviewer")).toBeTruthy());
  });

  it("offers Delete reviewer from the Edit reviewer details drawer", async () => {
    render(<AdminReviewers />);
    fireEvent.click(screen.getByText("Edit reviewer"));
    fireEvent.click(screen.getByText("Edit details"));
    await waitFor(() => expect(screen.getByText("Delete reviewer")).toBeTruthy());
  });

  it("sends the reviewer id and reports what was released + kept", async () => {
    adminPlatformApi.deleteReviewer.mockResolvedValue({
      assignments_removed: 141, reviews_kept: 12, batches_detached: 1,
    });
    render(<AdminReviewers />);
    fireEvent.click(screen.getByText("Manage"));
    fireEvent.click(await screen.findByText("Delete reviewer"));

    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "Abhijit Lele" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove reviewer" }));

    await waitFor(() => expect(adminPlatformApi.deleteReviewer).toHaveBeenCalledWith("rev-1"));
    await waitFor(() =>
      expect(screen.getByText(/141 application\(s\) released, 12 review\(s\) kept/)).toBeTruthy());
  });
});

// ── Jury roster wiring ───────────────────────────────────────────────────

describe("AdminJury — roster delete", () => {
  const openRoster = () => {
    render(<AdminJury />);
    fireEvent.click(screen.getByText("Jury Roster"));
  };

  beforeEach(() => mockAdminData({ jurors: [JUROR] }));

  it("shows a Delete button on each roster row, beside Manage", () => {
    openRoster();
    expect(screen.getByText("Manage")).toBeTruthy();
    expect(screen.getByLabelText("Delete Udayan Pawar")).toBeTruthy();
  });

  it("sends the juror id and reports released applications + picks", async () => {
    adminPlatformApi.deleteJuror.mockResolvedValue({
      assignments_removed: 2, picks_removed: 3, invite_removed: true,
    });
    openRoster();
    fireEvent.click(screen.getByLabelText("Delete Udayan Pawar"));

    fireEvent.change(screen.getByLabelText("Confirm member name"), { target: { value: "Udayan Pawar" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove jury member" }));

    await waitFor(() => expect(adminPlatformApi.deleteJuror).toHaveBeenCalledWith("jur-1"));
    await waitFor(() =>
      expect(screen.getByText(/2 application\(s\) released, 3 pick\(s\) cleared, invite cleared/)).toBeTruthy());
  });

  it("does not delete anyone on a cancelled confirm", async () => {
    openRoster();
    fireEvent.click(screen.getByLabelText("Delete Udayan Pawar"));
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByLabelText("Confirm member name")).toBeNull());
    expect(adminPlatformApi.deleteJuror).not.toHaveBeenCalled();
  });
});
