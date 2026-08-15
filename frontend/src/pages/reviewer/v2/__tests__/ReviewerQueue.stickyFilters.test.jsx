// The reviewer queue unmounts whenever a reviewer opens an application
// (/reviewer/eval/:track/:appId), so its filters used to reset on every single
// return trip.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ReviewerQueue from "../ReviewerQueue.jsx";

const QUEUE = [
  { applicationId: "TIR-1", name: "TirCo", founders: ["A"], industry: "Robotics",
    stage: "Prototype", track: "tir", ai: { overall: 7 }, reviewStatus: "not-started",
    myReco: null, due: null },
  { applicationId: "VIP-1", name: "VipCo", founders: ["B"], industry: "Health",
    stage: "Pilot", track: "sip", ai: { overall: 6 }, reviewStatus: "not-started",
    myReco: null, due: null },
];

const queueAsync = () => ({ data: QUEUE, loading: false, error: null, reload: vi.fn() });

describe("ReviewerQueue sticky filters", () => {
  it("keeps the track filter after the queue unmounts and remounts", () => {
    const first = render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    expect(screen.getByText("TirCo")).toBeInTheDocument();
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
  });

  it("keeps the search text after a remount", () => {
    const first = render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "TirCo" } });
    first.unmount();

    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    expect(screen.getByPlaceholderText(/search/i)).toHaveValue("TirCo");
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
  });

  it("lets an explicit dashboard industry pick override the stored domain filter", () => {
    // Reviewer had narrowed the queue to Robotics and left it there.
    const first = render(
      <ReviewerQueue onOpen={vi.fn()} initialDomain="Robotics" queueAsync={queueAsync()} />,
    );
    expect(screen.queryByText("VipCo")).not.toBeInTheDocument();
    first.unmount();

    // Clicking a different industry on the dashboard is a deliberate act and
    // must win over whatever was remembered.
    render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Health" queueAsync={queueAsync()} />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();
    expect(screen.queryByText("TirCo")).not.toBeInTheDocument();
  });

  it("clearing filters also clears what was persisted", () => {
    const first = render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    fireEvent.click(screen.getByRole("button", { name: "TIR" }));
    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    first.unmount();

    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={queueAsync()} />);
    expect(screen.getByText("VipCo")).toBeInTheDocument();
  });
});
