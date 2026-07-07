import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LinkAnswer from "../LinkAnswer.jsx";

describe("LinkAnswer", () => {
  it("renders a new-tab anchor for a full URL", () => {
    render(<LinkAnswer value="https://linkedin.com/in/alice" />);
    const a = screen.getByRole("link", { name: /linkedin\.com\/in\/alice/i });
    expect(a).toHaveAttribute("href", "https://linkedin.com/in/alice");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("prepends https:// when the scheme is missing", () => {
    render(<LinkAnswer value="linkedin.com/in/bob" />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href", "https://linkedin.com/in/bob",
    );
  });

  it("renders the empty placeholder for a blank value", () => {
    render(<LinkAnswer value="" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/No answer provided/i)).toBeInTheDocument();
  });
});
