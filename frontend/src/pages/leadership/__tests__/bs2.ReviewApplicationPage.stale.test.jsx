// Swarm2 / leadership_review — Prev/Next stale state on the review page.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const params = { track: "tir", id: "app-A" };
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useParams: () => params,
  useNavigate: () => navigate,
}));
vi.mock("../../../lib/leadershipApi.js", () => ({
  leadershipApi: {
    getApplication: vi.fn(),
    getVipMemoV2: vi.fn(() => Promise.reject(new Error("404"))),
    generateVipMemo: vi.fn(() => new Promise(() => {})),
    fileSignedUrl: vi.fn(),
  },
}));

import { leadershipApi } from "../../../lib/leadershipApi.js";
import ReviewApplicationPage from "../ReviewApplicationPage.jsx";

const detail = (id, displayId, score, deck) => ({
  id, track: "tir", native_track: "tir", display_id: displayId,
  application: { status: "under_review", evidence_files: [deck] },
  ai_screening: { score_overall: score, project_name: `Project ${id}` },
  reviews: [], reviewer_assignments: [], status_history: [], admin_decisions: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  params.id = "app-A";
  sessionStorage.clear();
});

describe("Review page after Prev/Next to an app whose detail fails to load", () => {
  it("does not keep showing the previous app's ID / AI score / AI panel", async () => {
    leadershipApi.getApplication.mockImplementation((id) => (id === "app-A"
      ? Promise.resolve(detail("app-A", "TIR-27001", 9.1, { name: "a.pdf", storage_path: "a/a.pdf" }))
      : Promise.reject(new Error("boom"))));
    const { rerender } = render(<ReviewApplicationPage />);
    await screen.findAllByText("TIR-27001");
    params.id = "app-B";
    rerender(<ReviewApplicationPage />);
    await screen.findByRole("alert");
    // We are on app-B now (URL), but header still says TIR-27001 and 9.1.
    expect(screen.queryAllByText("TIR-27001")).toHaveLength(0);
    expect(document.querySelector(".h-score").textContent).not.toContain("9.1");
    expect(document.querySelector(".ai-score-num")?.textContent || "").not.toContain("9.1");
  });
});

describe("FileGridAnswer state leaks across Prev/Next", () => {
  it("an error shown for app A's file is not shown on app B's file", async () => {
    leadershipApi.getApplication.mockImplementation((id) => Promise.resolve(id === "app-A"
      ? detail("app-A", "TIR-27001", 9.1, { name: "a.pdf", storage_path: "a/a.pdf" })
      : detail("app-B", "TIR-27002", 5.0, { name: "b.pdf", storage_path: "b/b.pdf" })));
    leadershipApi.fileSignedUrl.mockRejectedValue({ details: { code: "file_not_available" } });
    const { rerender } = render(<ReviewApplicationPage />);
    await screen.findByText("a.pdf");
    fireEvent.click(screen.getAllByText("Download ↓")[0]);
    await screen.findByText("File isn't in storage (never uploaded).");
    params.id = "app-B";
    rerender(<ReviewApplicationPage />);
    await screen.findByText("b.pdf");
    // app B's deck has never been clicked — no error should show for it.
    expect(screen.queryByText("File isn't in storage (never uploaded).")).toBeNull();
  });
});
