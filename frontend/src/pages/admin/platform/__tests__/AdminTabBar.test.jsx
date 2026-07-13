import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminTabBar } from "../AdminPortal.jsx";

describe("AdminTabBar", () => {
  it("shows a Jury Selected tab with its badge", () => {
    render(
      <AdminTabBar
        page="pipeline" setPage={vi.fn()} decisionMode="reviewer"
        appsBadge={423} rejectedBadge={32} reviewBadge={140} juryBadge={140}
      />,
    );
    expect(screen.getByText("Jury Selected")).toBeInTheDocument();
    expect(screen.getByText("SELECTED FOR JURY")).toBeInTheDocument();
  });
});
