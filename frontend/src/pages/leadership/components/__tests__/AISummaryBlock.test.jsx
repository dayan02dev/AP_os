import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AISummaryBlock from "../AISummaryBlock.jsx";

const aiScreening = {
  summary: JSON.stringify({
    verdict: "Affordable elder-care companion, still pre-pilot.",
    recommendation: "Do not advance to jury.",
    top_strength: "Affordability-first design.",
    top_concern: "No deployed traction.",
    program_fit: "Partial fit.",
  }),
  flags: {},
};

describe("AISummaryBlock structured summary", () => {
  it("shows verdict, recommendation, strength, concern and fit WITHOUT any accordion", () => {
    render(<AISummaryBlock aiScreening={aiScreening} />);
    expect(screen.getByText(/Affordable elder-care companion/i)).toBeInTheDocument();
    expect(screen.getByText(/Do not advance to jury/i)).toBeInTheDocument();
    expect(screen.getByText(/Affordability-first design/i)).toBeInTheDocument();
    expect(screen.getByText(/No deployed traction/i)).toBeInTheDocument();
    expect(screen.getByText(/Partial fit/i)).toBeInTheDocument();
    expect(screen.queryByText("▸")).not.toBeInTheDocument();
  });
});
