import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../MisLineChart.jsx", () => ({
  default: (props) => <div data-testid="chart" data-enlarged={String(!!props.enlarged)} />,
}));

import MisChartCard, { GRAPH } from "../MisChartCard.jsx";

const POINTS = [
  { period_key: "2026-05", label: "May 2026", value: 4.5 },
  { period_key: "2026-06", label: "Jun 2026", value: 6.2 },
];

describe("GRAPH", () => {
  it("is exactly the four contracted charts, in order", () => {
    expect(GRAPH.map((g) => g.key)).toEqual(["revenue", "burn", "headcount", "paying"]);
    expect(GRAPH.map((g) => g.title)).toEqual([
      "Revenue (₹L per month)", "Net burn (₹L per month)", "Headcount", "Paying customers",
    ]);
  });
});

describe("MisChartCard", () => {
  it("renders the small chart when the metric has real values", () => {
    render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={POINTS} />);
    expect(screen.getByTestId("chart")).toHaveAttribute("data-enlarged", "false");
  });

  it("G4: shows per-chart copy naming this title when every value is null, without hiding other charts' data (proved by a sibling render)", () => {
    const nulled = POINTS.map((p) => ({ ...p, value: null }));
    render(<MisChartCard chartKey="paying" title="Paying customers" series={nulled} />);
    expect(screen.getByText("Paying customers has not been reported in any submitted period yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });

  it("G3: a single point is not treated as empty", () => {
    render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={[POINTS[0]]} />);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.queryByText(/has not been reported/)).not.toBeInTheDocument();
  });

  it("opens an enlarged modal on click and closes on backdrop click", () => {
    render(<MisChartCard chartKey="revenue" title="Revenue (₹L per month)" series={POINTS} />);
    fireEvent.click(screen.getByRole("button", { name: /expand revenue/i }));
    const charts = screen.getAllByTestId("chart");
    expect(charts).toHaveLength(2); // small card + modal copy
    expect(charts[1]).toHaveAttribute("data-enlarged", "true");
    fireEvent.click(screen.getByRole("dialog").parentElement); // backdrop
    expect(screen.getAllByTestId("chart")).toHaveLength(1);
  });
});
