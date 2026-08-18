import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// vi.mock factories are hoisted above ordinary top-level `const`
// declarations, so the mocks they reference must be created via
// vi.hoisted() — a plain `const chartCtor = vi.fn()` above vi.mock() hits
// "Cannot access 'chartCtor' before initialization" under this vitest
// version.
const { destroyMock, chartCtor } = vi.hoisted(() => {
  const destroyMock = vi.fn();
  const chartCtor = vi.fn(() => ({ destroy: destroyMock }));
  return { destroyMock, chartCtor };
});

vi.mock("chart.js", () => ({
  Chart: Object.assign(chartCtor, { register: vi.fn() }),
  LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {},
  CategoryScale: {}, Filler: {}, Tooltip: {},
}));

import MisLineChart from "../MisLineChart.jsx";

const SERIES = [
  { period_key: "2026-05", label: "May 2026", value: 4.5 },
  { period_key: "2026-06", label: "Jun 2026", value: 6.2 },
];

beforeEach(() => { chartCtor.mockClear(); destroyMock.mockClear(); });

describe("MisLineChart", () => {
  it("maps series into Chart.js labels/data in order", () => {
    render(<MisLineChart series={SERIES} chartKey="revenue" />);
    const config = chartCtor.mock.calls[0][1];
    expect(config.data.labels).toEqual(["May 2026", "Jun 2026"]);
    expect(config.data.datasets[0].data).toEqual([4.5, 6.2]);
  });

  it("destroys the previous chart instance when the series changes", () => {
    const { rerender } = render(<MisLineChart series={SERIES} chartKey="revenue" />);
    rerender(<MisLineChart series={[...SERIES, { period_key: "2026-07", label: "Jul 2026", value: 9.1 }]} chartKey="revenue" />);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("gives only the last point a nonzero radius — 3.5 by default", () => {
    render(<MisLineChart series={SERIES} chartKey="revenue" />);
    const { pointRadius } = chartCtor.mock.calls[0][1].data.datasets[0];
    const dataset = { data: SERIES.map((p) => p.value) };
    expect(pointRadius({ dataIndex: 0, dataset })).toBe(0);
    expect(pointRadius({ dataIndex: 1, dataset })).toBe(3.5);
  });

  it("uses radius 3 for the last point when enlarged", () => {
    render(<MisLineChart series={SERIES} chartKey="revenue" enlarged />);
    const { pointRadius } = chartCtor.mock.calls[0][1].data.datasets[0];
    const dataset = { data: SERIES.map((p) => p.value) };
    expect(pointRadius({ dataIndex: 1, dataset })).toBe(3);
  });

  it("suffixes revenue/burn tooltip values with L but leaves headcount/paying plain", () => {
    render(<MisLineChart series={SERIES} chartKey="revenue" />);
    const revenueLabel = chartCtor.mock.calls[0][1].options.plugins.tooltip.callbacks.label;
    expect(revenueLabel({ parsed: { y: 4.5 } })).toBe("₹4.5L");

    render(<MisLineChart series={SERIES} chartKey="headcount" />);
    const headcountLabel = chartCtor.mock.calls[1][1].options.plugins.tooltip.callbacks.label;
    expect(headcountLabel({ parsed: { y: 7 } })).toBe("7");
  });

  it("sets no legend plugin config and disables intersect on hover", () => {
    render(<MisLineChart series={SERIES} chartKey="revenue" />);
    const { options } = chartCtor.mock.calls[0][1];
    expect(options.plugins.legend).toBeUndefined();
    expect(options.interaction).toEqual({ mode: "index", intersect: false });
  });
});
