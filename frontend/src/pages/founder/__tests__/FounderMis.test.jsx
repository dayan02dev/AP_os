import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderMis from "../FounderMis.jsx";
import { founderApi } from "../../../lib/founderApi.js";
import { misEmptyReason, misEmptyCopy } from "../../../lib/misEmptyState.js";

// FounderMis.jsx composes MisChartCard (Task 6) four times; this page's own
// tests prove what props each chart gets, not how MisChartCard renders them
// — Task 6's own test file already proves G3/G4 render correctly given a
// single point / an all-null series. Per Global Constraints, mock the real
// component rather than letting Chart.js anywhere near jsdom.
vi.mock("../../../components/MisChartCard.jsx", () => ({
  default: (props) => (
    <div
      data-testid={`card-${props.chartKey}`}
      data-values={JSON.stringify((props.series || []).map((p) => p.value))}
    />
  ),
  GRAPH: [
    { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
    { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
    { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
    { key: "paying", title: "Paying customers", metricKey: "active_customers" },
  ],
}));

// ── Fixture builders ──────────────────────────────────────────────────────

function idxRow(periodKey, label, status, dueDate, overdue = false) {
  return { period_key: periodKey, label, status, due_date: dueDate, overdue };
}

function mainIndex(over = {}) {
  return {
    monthly: [
      idxRow("2026-05", "May 2026", "submitted", "2026-06-05", false),
      idxRow("2026-06", "Jun 2026", "draft", "2026-07-05", true),
    ],
    quarterly: [idxRow("FY26-27-Q1", "FY26-27 Q1", "draft", "2026-07-15", false)],
    ...over,
  };
}

// A period bundle at the shape `getMisPeriod` actually returns — only the
// two fields FounderMis.jsx and buildMisChartSeries read (`period`,
// `metrics`), trimmed to the minimum, real field names from mis_query.
function bundle(periodKey, label, status, metrics = {}, submittedAt = null) {
  return {
    period: { period_key: periodKey, label, status, submitted_at: submittedAt },
    metrics: Object.entries(metrics).map(([metric_key, actual]) => ({ metric_key, actual })),
  };
}

// Resolves getMisPeriod(kind, key) against a plain {key: bundle} map so each
// test only declares the bundles it needs; a request for an undeclared key
// rejects loudly rather than hanging silently.
function mockGetMisPeriod(map) {
  return vi.fn((kind, key) => {
    const b = map[key];
    if (!b) return Promise.reject(new Error(`no fixture for ${kind}/${key}`));
    return Promise.resolve(b);
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("FounderMis — read-only graphical view", () => {
  it("G1: not onboarded yet — renders the opens-once-onboarded copy, fetches no period bundles", async () => {
    vi.spyOn(founderApi, "getMis").mockResolvedValue({ monthly: [], quarterly: [] });
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod");
    render(<FounderMis />);
    await screen.findByText(/MIS reporting opens once your venture is onboarded\. Nothing is due yet\./);
    expect(getMisPeriod).not.toHaveBeenCalled();
  });

  it("index read failure renders ErrorState", async () => {
    vi.spyOn(founderApi, "getMis").mockRejectedValue(new Error("network fell over"));
    render(<FounderMis />);
    await screen.findByText("network fell over");
  });

  it("G2 (overdue-backlog): periods exist, none submitted, one overdue — shows the overdue-backlog empty copy in the charts section and still renders period cards below it", async () => {
    const monthlyRows = [
      idxRow("2026-06", "Jun 2026", "draft", "2026-07-05", true),
      idxRow("2026-07", "Jul 2026", "draft", "2026-08-05", false),
    ];
    const idx = mainIndex({ monthly: monthlyRows, quarterly: [] });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": bundle("2026-06", "Jun 2026", "draft", {}),
      "2026-07": bundle("2026-07", "Jul 2026", "draft", {}),
    }));
    render(<FounderMis />);

    const expected = misEmptyCopy(misEmptyReason(monthlyRows));
    await screen.findByText(expected);
    expect(screen.queryByTestId("card-revenue")).not.toBeInTheDocument();

    // period cards still render underneath the empty-charts message
    expect(screen.getByText("Jun 2026")).toBeInTheDocument();
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet received")).toHaveLength(2);
  });

  it("G2 (not-due-yet): periods exist, none overdue — shows the not-due-yet empty copy, distinct from the overdue-backlog copy", async () => {
    const monthlyRows = [idxRow("2026-06", "Jun 2026", "draft", "2026-07-05", false)];
    const idx = mainIndex({ monthly: monthlyRows, quarterly: [] });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-06": bundle("2026-06", "Jun 2026", "draft", {}),
    }));
    render(<FounderMis />);

    const expected = misEmptyCopy(misEmptyReason(monthlyRows));
    expect(expected).not.toMatch(/overdue/);
    await screen.findByText(expected);
  });

  it("G3: exactly one submitted monthly period is not folded into the G2 empty state — every chart card renders a one-point series", async () => {
    const idx = mainIndex({
      monthly: [idxRow("2026-05", "May 2026", "submitted", "2026-06-05", false)],
      quarterly: [],
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-05": bundle("2026-05", "May 2026", "submitted", {
        revenue_month: 4.5, net_burn_month: 22, headcount_eom: 7, active_customers: 2,
      }, "2026-06-01T00:00:00Z"),
    }));
    render(<FounderMis />);

    await waitFor(() => expect(screen.getByTestId("card-revenue")).toBeInTheDocument());
    expect(screen.getByTestId("card-revenue")).toHaveAttribute("data-values", JSON.stringify([4.5]));
    expect(screen.getByTestId("card-burn")).toHaveAttribute("data-values", JSON.stringify([22]));
    expect(screen.getByTestId("card-headcount")).toHaveAttribute("data-values", JSON.stringify([7]));
    expect(screen.getByTestId("card-paying")).toHaveAttribute("data-values", JSON.stringify([2]));
    expect(screen.queryByText(/has not been reported/)).not.toBeInTheDocument();
  });

  it("G4: a metric null in every submitted period still renders its own tile, not folded into the others", async () => {
    const idx = mainIndex({
      monthly: [
        idxRow("2026-05", "May 2026", "submitted", "2026-06-05", false),
        idxRow("2026-06", "Jun 2026", "submitted", "2026-07-05", false),
      ],
      quarterly: [],
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-05": bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 }, "2026-06-01T00:00:00Z"),
      "2026-06": bundle("2026-06", "Jun 2026", "submitted", { revenue_month: 6.2 }, "2026-07-01T00:00:00Z"),
    }));
    render(<FounderMis />);

    await waitFor(() => expect(screen.getByTestId("card-revenue")).toBeInTheDocument());
    expect(screen.getByTestId("card-revenue")).toHaveAttribute("data-values", JSON.stringify([4.5, 6.2]));
    // active_customers was never sent in either commit — null, not dropped.
    expect(screen.getByTestId("card-paying")).toHaveAttribute("data-values", JSON.stringify([null, null]));
  });

  it("period cards: label, status, received date, newest first", async () => {
    const idx = mainIndex({
      monthly: [
        idxRow("2026-05", "May 2026", "submitted", "2026-06-05", false),
        idxRow("2026-06", "Jun 2026", "draft", "2026-07-05", true),
        idxRow("2026-07", "Jul 2026", "draft", "2026-08-05", false),
      ],
      quarterly: [],
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-05": bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 }, "2026-06-01T00:00:00Z"),
      "2026-06": bundle("2026-06", "Jun 2026", "draft", {}),
      "2026-07": bundle("2026-07", "Jul 2026", "draft", {}),
    }));
    const { container } = render(<FounderMis />);
    await screen.findByText("Jul 2026");

    const labels = Array.from(container.querySelectorAll(".mis-period-card-label")).map((el) => el.textContent);
    expect(labels).toEqual(["Jul 2026", "Jun 2026", "May 2026"]); // newest first

    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet received")).toHaveLength(2);
    expect(screen.getByText(new Date("2026-06-01T00:00:00Z").toLocaleDateString())).toBeInTheDocument();
  });

  it("kind toggle switches which kind's period cards render, without refetching or affecting the (monthly-only) charts", async () => {
    const idx = mainIndex({
      monthly: [idxRow("2026-05", "May 2026", "submitted", "2026-06-05", false)],
      quarterly: [idxRow("FY26-27-Q1", "FY26-27 Q1", "draft", "2026-07-15", false)],
    });
    vi.spyOn(founderApi, "getMis").mockResolvedValue(idx);
    const getMisPeriod = vi.spyOn(founderApi, "getMisPeriod").mockImplementation(mockGetMisPeriod({
      "2026-05": bundle("2026-05", "May 2026", "submitted", { revenue_month: 4.5 }, "2026-06-01T00:00:00Z"),
      "FY26-27-Q1": bundle("FY26-27-Q1", "FY26-27 Q1", "draft", {}),
    }));
    render(<FounderMis />);
    await screen.findByText("May 2026");
    expect(screen.getByTestId("card-revenue")).toHaveAttribute("data-values", JSON.stringify([4.5]));
    const callsBefore = getMisPeriod.mock.calls.length;

    fireEvent.click(screen.getByText("Quarterly"));
    await screen.findByText("FY26-27 Q1");
    expect(screen.queryByText("May 2026")).not.toBeInTheDocument();
    expect(getMisPeriod.mock.calls.length).toBe(callsBefore); // both kinds already fetched up front
    expect(screen.getByTestId("card-revenue")).toHaveAttribute("data-values", JSON.stringify([4.5])); // unaffected by the toggle
  });
});
