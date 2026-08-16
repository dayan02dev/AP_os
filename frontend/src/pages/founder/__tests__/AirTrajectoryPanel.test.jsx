import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AirTrajectoryPanel from "../components/AirTrajectoryPanel.jsx";

const round = (over = {}) => ({
  id: "r1", round_label: "FY26-27-Q2", status: "draft",
  submitted_at: null, verified_at: null, ...over,
});

const rollups = (overall) => ({
  claimed: { technology: null, commercial: null, overall },
  verified: { technology: null, commercial: null, overall: null },
});

describe("AirTrajectoryPanel", () => {
  it("renders the one reachable point with the round's label and claimed overall", () => {
    render(<AirTrajectoryPanel round={round()} rollups={rollups(5)} />);
    expect(screen.getByText("FY26-27-Q2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders — for a null overall rather than omitting the point", () => {
    render(<AirTrajectoryPanel round={round()} rollups={rollups(null)} />);
    expect(screen.getByText("FY26-27-Q2")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("the 'not available yet' note is present for a draft round", () => {
    render(<AirTrajectoryPanel round={round({ status: "draft" })} rollups={rollups(5)} />);
    expect(screen.getByText(/Earlier rounds aren't available here yet/i)).toBeInTheDocument();
  });

  it("the 'not available yet' note is present for a submitted round too — not conditional on round state", () => {
    render(<AirTrajectoryPanel round={round({ status: "submitted", submitted_at: "2026-08-01T00:00:00Z" })} rollups={rollups(5)} />);
    expect(screen.getByText(/Earlier rounds aren't available here yet/i)).toBeInTheDocument();
  });

  it("the note is present even when overall is a real number — not gated on the point having data", () => {
    render(<AirTrajectoryPanel round={round()} rollups={rollups(7)} />);
    expect(screen.getByText(/Earlier rounds aren't available here yet/i)).toBeInTheDocument();
  });
});
