import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TextAnswer from "../answers/TextAnswer.jsx";

// Export PDF is window.print() over this DOM, so anything hidden behind a
// "Read more" toggle is missing from the exported PDF. These tests pin the
// "always render the whole answer" contract.

const LONG = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");

describe("TextAnswer", () => {
  it("renders a long essay in full, with no Read more toggle", () => {
    const { container } = render(<TextAnswer value={LONG} />);

    expect(container.textContent).toContain("word0");
    expect(container.textContent).toContain("word399");
    expect(container.textContent).not.toContain("…");
    expect(container.textContent).toHaveLength(LONG.length);
    expect(screen.queryByRole("button", { name: /read (more|less)/i })).toBeNull();
  });

  it("renders a short answer unchanged", () => {
    const { container } = render(<TextAnswer value="Yes" />);
    expect(container.textContent).toBe("Yes");
  });

  it("preserves newlines via the pre-wrap answer container", () => {
    const { container } = render(<TextAnswer value={"line one\nline two"} />);
    expect(container.querySelector(".ans-inset")).not.toBeNull();
    expect(container.textContent).toBe("line one\nline two");
  });

  it("falls through to the empty state for blank values", () => {
    for (const v of [null, undefined, "   "]) {
      const { container } = render(<TextAnswer value={v} />);
      expect(container.querySelector(".ans-inset")).toBeNull();
    }
  });
});
