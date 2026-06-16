// Smoke tests for Task 15: jury-mode visual preview screens.
// Both components use only local mock data — no API mocks needed.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── shared mocks ────────────────────────────────────────────────────────────
vi.mock("../shell/osAtoms", () => ({
  PageHead: ({ eyebrow, title }) => <div data-testid="page-head">{eyebrow} {title}</div>,
  Chip: ({ children, tone }) => <span data-chip={tone}>{children}</span>,
  FlagDot: () => null,
}));
vi.mock("../../../../components/admin/PreviewBadge", () => ({
  PreviewBadge: () => <span data-testid="preview-badge">Preview — backend pending</span>,
}));
vi.mock("../screens/ComparativeReviewModel", () => ({
  ComparativeReviewModel: () => <div data-testid="comparative-review-model" />,
}));

// ── AdminJury smoke ─────────────────────────────────────────────────────────
import { AdminJury } from "../screens/AdminJury";

describe("AdminJury smoke", () => {
  it("renders with PreviewBadge and table heading", () => {
    render(<AdminJury />);
    expect(screen.getByTestId("preview-badge")).toBeTruthy();
    expect(screen.getByText("Karkhana Robotics")).toBeTruthy();
    expect(screen.getByText("Assigned Jury")).toBeTruthy();
  });

  it("shows the Scores In chip", () => {
    render(<AdminJury />);
    // The Chip with 2/2 is rendered
    expect(screen.getByText("2/2")).toBeTruthy();
  });
});

// ── AdminGate2 smoke ────────────────────────────────────────────────────────
import { AdminGate2 } from "../screens/AdminGate2";

describe("AdminGate2 smoke", () => {
  it("renders with PreviewBadge", () => {
    render(<AdminGate2 goDetail={() => {}} />);
    expect(screen.getByTestId("preview-badge")).toBeTruthy();
  });

  it("shows the 4 variant tabs", () => {
    render(<AdminGate2 goDetail={() => {}} />);
    // "A · Status" appears in the tab bar (exact) and also in the variant chip; use getAllByText
    expect(screen.getAllByText(/A · Status/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/B · Interview Scheduling/i)).toBeTruthy();
    expect(screen.getByText(/C · Batch decision/i)).toBeTruthy();
    expect(screen.getByText(/D · My history/i)).toBeTruthy();
  });

  it("renders ComparativeReviewModel for the first startup card", () => {
    render(<AdminGate2 goDetail={() => {}} />);
    expect(screen.getByTestId("comparative-review-model")).toBeTruthy();
  });
});
