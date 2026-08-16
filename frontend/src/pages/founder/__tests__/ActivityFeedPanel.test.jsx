import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ActivityFeedPanel from "../components/ActivityFeedPanel.jsx";

const event = (over = {}) => ({
  at: "2026-06-01T00:00:00Z", color: "green", text: "Monthly update June 2026 submitted",
  meta: "6/1/2026", ...over,
});

describe("ActivityFeedPanel", () => {
  it("renders events in the given order, with dot color from FEED_COLOR", () => {
    const events = [
      event({ text: "First event", color: "green" }),
      event({ text: "Second event", color: "amber" }),
      event({ text: "Third event", color: "blue" }),
    ];
    render(<ActivityFeedPanel events={events} />);
    const rows = document.querySelectorAll(".fj-dash-feed-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".fj-dash-feed-text").textContent).toBe("First event");
    expect(rows[1].querySelector(".fj-dash-feed-text").textContent).toBe("Second event");
    expect(rows[2].querySelector(".fj-dash-feed-text").textContent).toBe("Third event");
    expect(rows[0].querySelector(".fj-dash-feed-dot").style.background).toBe("var(--accent-green)");
    expect(rows[1].querySelector(".fj-dash-feed-dot").style.background).toBe("var(--accent-amber)");
    expect(rows[2].querySelector(".fj-dash-feed-dot").style.background).toBe("var(--artblue)");
  });

  it("falls back to the dim token for an unrecognised color key", () => {
    render(<ActivityFeedPanel events={[event({ color: "mystery" })]} />);
    const dot = document.querySelector(".fj-dash-feed-dot");
    expect(dot.style.background).toBe("var(--ink-dim)");
  });

  it("renders the meta text alongside each event", () => {
    render(<ActivityFeedPanel events={[event({ meta: "6/1/2026" })]} />);
    expect(screen.getByText("6/1/2026")).toBeInTheDocument();
  });

  it("empty events — the one-cause empty copy, no feed rows", () => {
    render(<ActivityFeedPanel events={[]} />);
    expect(screen.getByText(/Nothing to show yet — your first submission will appear here/i)).toBeInTheDocument();
    expect(document.querySelectorAll(".fj-dash-feed-row")).toHaveLength(0);
  });

  it("renders no more than 8 rows even if given more (defence in depth)", () => {
    const events = Array.from({ length: 10 }, (_, i) => event({ text: `Event ${i}` }));
    render(<ActivityFeedPanel events={events} />);
    expect(document.querySelectorAll(".fj-dash-feed-row")).toHaveLength(8);
  });
});
