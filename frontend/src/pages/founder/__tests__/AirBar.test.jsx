import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AirBar from "../components/AirBar.jsx";

describe("AirBar", () => {
  it("renders nine segments", () => {
    const { container } = render(<AirBar name="Architecture" claimed={4} verified={3} />);
    expect(container.querySelectorAll("[data-air-seg]")).toHaveLength(9);
  });

  it("marks verified segments solid and the claimed remainder as ghost", () => {
    const { container } = render(<AirBar name="Architecture" claimed={5} verified={3} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "verified")).toHaveLength(3);
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(2);
    expect(segs.filter((s) => s.dataset.airSeg === "empty")).toHaveLength(4);
  });

  it("shows a draft lever as all-ghost rather than empty", () => {
    const { container } = render(<AirBar name="Architecture" claimed={4} verified={null} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "verified")).toHaveLength(0);
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(4);
  });

  it("renders an unanswered lever without throwing and shows a dash", () => {
    render(<AirBar name="Supply Chain" claimed={null} verified={null} />);
    expect(screen.getByText("Supply Chain")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clamps a verified level above claimed instead of rendering negative segments", () => {
    const { container } = render(<AirBar name="X" claimed={2} verified={5} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(0);
    expect(segs).toHaveLength(9);
  });
});
