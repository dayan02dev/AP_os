import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../lib/leadershipApi", () => ({
  leadershipApi: { fileSignedUrl: vi.fn(() => Promise.resolve({ url: "https://x/y.pdf" })) },
}));
vi.mock("../../../../components/AiSections.jsx", () => ({
  default: ({ sections }) => <div data-testid="ai-sections">{Object.keys(sections || {}).join(",")}</div>,
}));

import ApplicationSummaryCard from "../screens/ApplicationSummaryCard.jsx";

const STARTUP = {
  id: "app-1", name: "Acme AI", domain: "Robotics", stage: "Prototype",
  aiSummary: "A concise AI summary.",
  aiSections: { problem: ["p1"], solution: ["s1"] },
  reviews: [{ reco: "yes", notes: "solid team", overall: 7.5 }],
  application: { linkedin_url: "https://linkedin.com/in/x", resume_file: null },
};

describe("ApplicationSummaryCard", () => {
  it("renders the AI summary, sections, reviewer notes and the button", () => {
    render(<ApplicationSummaryCard startup={STARTUP} onViewFullApplication={() => {}} />);
    expect(screen.getByText("A concise AI summary.")).toBeTruthy();
    expect(screen.getByTestId("ai-sections")).toBeTruthy();
    expect(screen.getByText(/Reviewer 1/)).toBeTruthy();
    expect(screen.getByText(/View full application/)).toBeTruthy();
  });
  it("fires onViewFullApplication when the button is clicked", () => {
    const onView = vi.fn();
    render(<ApplicationSummaryCard startup={STARTUP} onViewFullApplication={onView} />);
    fireEvent.click(screen.getByText(/View full application/));
    expect(onView).toHaveBeenCalled();
  });
  it("degrades gracefully with a bare startup (no summary/sections/reviews)", () => {
    render(<ApplicationSummaryCard startup={{ id: "x", name: "Bare" }} onViewFullApplication={() => {}} />);
    expect(screen.getByText(/View full application/)).toBeTruthy();
  });
});
