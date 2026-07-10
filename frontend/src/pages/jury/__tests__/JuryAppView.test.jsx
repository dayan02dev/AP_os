import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const CONTENT = {
  id: "a1", applicationId: "TIR-1", track: "tir", name: "Alpha Robotics",
  application: { resume_file: null, linkedin_url: null },
  aiSummary: "A concise AI summary of the application.",
  aiSections: { problem: ["p1", "p2"], solution: ["s1"] },
  ai: { overall: 7.5 },
  fields: [], sections: [], attachments: [],
  mySelection: null,
  assignment: { assignment_id: "as1" },
};

vi.mock("../../../lib/juryApi.js", () => ({
  juryApi: {
    getContent: () => Promise.resolve(CONTENT),
    getQueue: () => Promise.resolve([]),
    fileSignedUrl: vi.fn(),
  },
}));

// The shared heavy renderers are stubbed — this test only asserts they are
// wired in (and, crucially, that NO scoring slider is rendered).
vi.mock("../../../components/FullApplication.jsx", () => ({
  default: () => <div data-testid="full-application">FULL APPLICATION</div>,
}));
vi.mock("../../../components/AiSections.jsx", () => ({
  default: ({ sections }) => (
    <div data-testid="ai-sections">{Object.keys(sections || {}).length} sections</div>
  ),
}));
vi.mock("../../../components/ProfilePills.jsx", () => ({
  default: () => <div data-testid="profile-pills">PILLS</div>,
}));

import JuryAppView from "../JuryAppView.jsx";

function renderView() {
  return render(
    <JuryAppView
      track="tir"
      appId="a1"
      picks={[]}
      togglePick={vi.fn()}
      setNote={vi.fn()}
      onBack={vi.fn()}
      onOpen={vi.fn()}
      queue={[]}
    />,
  );
}

describe("JuryAppView (read-only, no scoring)", () => {
  it("renders AiSections, FullApplication, ProfilePills and a Pick toggle", async () => {
    renderView();
    expect(await screen.findByTestId("full-application")).toBeTruthy();
    expect(screen.getByTestId("ai-sections")).toBeTruthy();
    expect(screen.getByTestId("profile-pills")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pick/i })).toBeTruthy();
  });

  it("renders NO scoring slider anywhere in the DOM", async () => {
    const { container } = renderView();
    await screen.findByTestId("full-application");
    expect(container.querySelector(".os-slider-row")).toBeNull();
    expect(container.querySelector(".os-slider-track")).toBeNull();
    expect(container.querySelectorAll("[class*='os-slider']").length).toBe(0);
  });
});
