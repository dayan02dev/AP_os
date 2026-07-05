import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AiSections from "../AiSections.jsx";

const SAMPLE = {
  problem: ["Problem bullet one", "Problem bullet two", "Problem bullet three"],
  solution: ["Solution bullet"],
  moats: ["Moat bullet"],
  watchouts: ["Watchout bullet"],
};

describe("AiSections", () => {
  it("dropdown variant shows all four section labels", () => {
    render(<AiSections sections={SAMPLE} variant="dropdown" />);
    expect(screen.getByText("Problem Description")).toBeInTheDocument();
    expect(screen.getByText("Solution Description")).toBeInTheDocument();
    expect(screen.getByText("Moats & Technology Edge")).toBeInTheDocument();
    expect(screen.getByText("Watch-outs or Flags")).toBeInTheDocument();
  });

  it("dropdown variant toggles a section open on click", () => {
    render(<AiSections sections={SAMPLE} variant="dropdown" />);
    expect(screen.queryByText("Solution bullet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Solution Description"));
    expect(screen.getByText("Solution bullet")).toBeInTheDocument();
  });

  it("leadership variant renders every bullet without accordions", () => {
    render(<AiSections sections={SAMPLE} variant="leadership" />);
    expect(screen.getByText("Solution bullet")).toBeInTheDocument();
    expect(screen.getByText("Moat bullet")).toBeInTheDocument();
  });

  it("renders an empty-state note when there are no sections", () => {
    render(<AiSections sections={null} variant="dropdown" />);
    expect(screen.getByText(/not generated yet/i)).toBeInTheDocument();
  });
});

test("renders a Founder Check block when sections.founder is present", () => {
  render(
    <AiSections
      variant="leadership"
      sections={{
        problem: ["p1"],
        founder: ["Verdict: EXCEPTIONAL (HIGH confidence)", "Top signals: a, b"],
      }}
    />
  );
  expect(screen.getByText("Founder Check")).toBeInTheDocument();
  expect(
    screen.getByText("Verdict: EXCEPTIONAL (HIGH confidence)")
  ).toBeInTheDocument();
});

test("no Founder Check block when sections.founder is absent", () => {
  render(<AiSections variant="leadership" sections={{ problem: ["p1"] }} />);
  expect(screen.queryByText("Founder Check")).not.toBeInTheDocument();
});
