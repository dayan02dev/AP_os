import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import EditWindowCountdown from "../scoring/EditWindowCountdown.jsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function inFutureMs(ms) {
  return new Date(Date.now() + ms).toISOString();
}

describe("EditWindowCountdown", () => {
  it("renders mm:ss for >5 min in normal color", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(10 * 60 * 1000)} />);
    const el = screen.getByText(/\d+:\d{2} left/);
    expect(el).toBeInTheDocument();
    expect(el).not.toHaveClass("amber");
    expect(el).not.toHaveClass("coral");
  });

  it("renders amber class when <5 min remain", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(4 * 60 * 1000)} />);
    expect(screen.getByText(/\d+:\d{2} left/)).toHaveClass("amber");
  });

  it("renders coral class when <1 min remains", () => {
    render(<EditWindowCountdown lockedAt={inFutureMs(30 * 1000)} />);
    expect(screen.getByText(/\d+:\d{2} left/)).toHaveClass("coral");
  });

  it("fires onExpire when the deadline passes", () => {
    const onExpire = vi.fn();
    render(<EditWindowCountdown lockedAt={inFutureMs(1000)} onExpire={onExpire} />);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
