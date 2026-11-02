// Reviewer queue filter fixes (2026-11): inactive rows hidden by default,
// faceted chip counts, and a dashboard industry pick that applies once.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import ReviewerQueue from "../ReviewerQueue.jsx";
import { writeStickyState } from "../../../../hooks/useStickyState.js";

const row = (id, track, reviewStatus, industry, extra = {}) => ({
  id, track, applicationId: `${track.toUpperCase()}-${id}`, name: `App ${id}`,
  founders: ["F"], industry, stage: "MVP", due: null, ai: null, reviewStatus,
  myScore: null, myReco: reviewStatus === "submitted" ? "yes" : null,
  movedToTrack: null, detached: false, closed: false, ...extra,
});
const QUEUE = [
  row("v1", "sip", "not-started", "Climate"),
  row("t1", "tir", "not-started", "Health"),
  row("v2", "sip", "submitted", "Climate"),
  row("v3", "sip", "submitted", "Agri", { closed: true }),
  row("t2", "tir", "submitted", "Climate", { detached: true }),
  row("v4", "sip", "not-started", "Climate"),
];
const qa = (data) => ({ data, loading: false, error: null, reload: vi.fn() });
const names = () => screen.queryAllByText(/^App /).map((n) => n.textContent);

describe("ReviewerQueue filters", () => {
  it("VIP + Not Started + Climate lists exactly the two matching apps", () => {
    writeStickyState("reviewer.queue", "track", "sip");
    writeStickyState("reviewer.queue", "status", "not-started");
    writeStickyState("reviewer.queue", "domain", "Climate");
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={qa(QUEUE)} />);
    expect(names()).toEqual(["App v1", "App v4"]);
  });

  it("hides detached (unassigned) rows by default, like closed ones", () => {
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={qa(QUEUE)} />);
    expect(names()).not.toContain("App t2");
    expect(names()).not.toContain("App v3");
    expect(screen.getByText("4 of 4")).toBeInTheDocument();
  });

  it("facet chip counts reflect the other active filters", () => {
    writeStickyState("reviewer.queue", "track", "sip");
    writeStickyState("reviewer.queue", "showFilters", true);
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={qa(QUEUE)} />);
    const chip = (re) => screen.getAllByRole("button").find((b) => re.test(b.textContent));
    expect(chip(/^Climate\d+$/).textContent).toBe("Climate3");
    expect(chip(/^Health\d+$/)).toBeUndefined();
    expect(chip(/^Not Started\d+$/).textContent).toBe("Not Started2");
    expect(chip(/^Submitted\d+$/).textContent).toBe("Submitted1");
  });

  it("a dashboard industry pick is not re-applied on browser Back", () => {
    const first = render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Climate" navKey="k1" queueAsync={qa(QUEUE)} />);
    expect(names()).not.toContain("App t1");
    fireEvent.click(screen.getByText("Clear filters"));
    first.unmount();
    // Back to the same history entry: same key, same router state.
    render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Climate" navKey="k1" queueAsync={qa(QUEUE)} />);
    expect(names()).toContain("App t1");
  });

  it("a NEW dashboard pick still overrides the remembered industry", () => {
    const first = render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Climate" navKey="k1" queueAsync={qa(QUEUE)} />);
    first.unmount();
    render(<ReviewerQueue onOpen={vi.fn()} initialDomain="Health" navKey="k2" queueAsync={qa(QUEUE)} />);
    expect(names()).toEqual(["App t1"]);
  });

  it("keeps showing rows while a background refetch is in flight", () => {
    render(<ReviewerQueue onOpen={vi.fn()} queueAsync={{ data: QUEUE, loading: true, error: null, reload: vi.fn() }} />);
    expect(names()).toContain("App v1");
    expect(screen.queryByText(/Loading your queue/)).not.toBeInTheDocument();
  });
});
