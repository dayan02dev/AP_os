import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScoreSegmentInput from "../scoring/ScoreSegmentInput.jsx";

describe("ScoreSegmentInput", () => {
  it("renders 10 buttons", () => {
    render(<ScoreSegmentInput label="Problem" value={null} onChange={() => {}} />);
    const btns = screen.getAllByRole("radio");
    expect(btns).toHaveLength(10);
  });

  it("marks the selected button with aria-pressed=true", () => {
    render(<ScoreSegmentInput label="Problem" value={7} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Score 7 out of 10 for Problem/i }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("radio", { name: /Score 3 out of 10 for Problem/i }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("fires onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={null} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /Score 4 out of 10 for Problem/i }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("ArrowRight from value=10 wraps to 1", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={10} onChange={onChange} />);
    const user = userEvent.setup();
    const ten = screen.getByRole("radio", { name: /Score 10 out of 10 for Problem/i });
    ten.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("ArrowLeft from value=1 wraps to 10", async () => {
    const onChange = vi.fn();
    render(<ScoreSegmentInput label="Problem" value={1} onChange={onChange} />);
    const user = userEvent.setup();
    const one = screen.getByRole("radio", { name: /Score 1 out of 10 for Problem/i });
    one.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(10);
  });
});
