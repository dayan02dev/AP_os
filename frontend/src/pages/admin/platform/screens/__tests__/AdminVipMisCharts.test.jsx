// AdminVipMisCharts — the admin cohort MIS charts screen (spec §7/§6): the
// "mis" subtab's new default content, replacing AdminVipMisMatrix as the
// landing view. Seams mocked: lib/adminVipApi (network), components/
// MisChartCard.jsx (Chart.js lives underneath it — never rendered for real
// here, see MisLineChart.test.jsx for that coverage) and the untouched
// AdminVipMisMatrix.jsx (its own full test file already covers it; this
// file only proves the table toggle reaches it). useAsync (ui.jsx) is real.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("../../../../../lib/adminVipApi.js", () => ({
  adminVipApi: { getMisCharts: vi.fn() },
}));
vi.mock("../../../../../components/MisChartCard.jsx", () => ({
  default: (props) => <div data-testid={`card-${props.chartKey}`} />,
  GRAPH: [
    { key: "revenue", title: "Revenue (₹L per month)", metricKey: "revenue_month" },
    { key: "burn", title: "Net burn (₹L per month)", metricKey: "net_burn_month" },
    { key: "headcount", title: "Headcount", metricKey: "headcount_eom" },
    { key: "paying", title: "Paying customers", metricKey: "active_customers" },
  ],
}));
vi.mock("../AdminVipMisMatrix.jsx", () => ({ AdminVipMisMatrix: () => <div data-testid="matrix" /> }));

import { adminVipApi } from "../../../../../lib/adminVipApi.js";
import { AdminVipMisCharts } from "../AdminVipMisCharts.jsx";

const EMPTY_COHORT = { period_keys: [], series: { revenue: [], burn: [], headcount: [], paying: [] } };

// G6: zero onboarded ventures — page-level empty state, nothing else renders.
it("shows the no-startups empty state when the cohort is empty", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({ cohort: EMPTY_COHORT, startups: [] });
  render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(screen.getByText("No VIP startups are onboarded yet.")).toBeInTheDocument());
  // The G6 gate is page-level — no cohort roll-up section leaks through.
  expect(screen.queryByText("Cohort total")).not.toBeInTheDocument();
});

// G5: a startup that has never once opened its own MIS page.
it("G5: a startup that never opened MIS gets its own message, not the matrix's default dash", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({
    cohort: EMPTY_COHORT,
    startups: [{
      application_id: "a1", startup: "NeverOpened Co", has_any_period: false,
      monthly_status: [], latest_period: null,
      series: { revenue: [], burn: [], headcount: [], paying: [] },
    }],
  });
  render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(screen.getByText("Hasn't opened MIS reporting yet.")).toBeInTheDocument());
  // Distinct from G2 (opened, nothing submitted yet) — that copy must not
  // also appear for a venture that never opened MIS at all.
  expect(screen.queryByText(/No monthly update filed yet/)).not.toBeInTheDocument();
});

// G2: opened MIS (periods exist), but zero submitted monthly periods yet —
// distinguishable from G5 by has_any_period alone.
it("G2: a startup that opened MIS but submitted nothing shows the overdue/not-due copy, not G5's message", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({
    cohort: EMPTY_COHORT,
    startups: [{
      application_id: "a2", startup: "OpenedOnly Co", has_any_period: true,
      monthly_status: [
        { period_key: "2026-06", label: "Jun 2026", status: "draft", due_date: "2026-07-05", overdue: true },
      ],
      latest_period: null,
      series: { revenue: [], burn: [], headcount: [], paying: [] },
    }],
  });
  render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(screen.getByText(/No monthly update filed yet/)).toBeInTheDocument());
  expect(screen.queryByText("Hasn't opened MIS reporting yet.")).not.toBeInTheDocument();
});

it("toggles to the table view and renders the untouched AdminVipMisMatrix", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({ cohort: EMPTY_COHORT, startups: [] });
  render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => screen.getByRole("button", { name: /table/i }));
  expect(screen.queryByTestId("matrix")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /table/i }));
  expect(screen.getByTestId("matrix")).toBeInTheDocument();
});

// The cohort total is a partial sum (never zero-filled for absentees) — the
// UI must label it as such, not present it as the whole cohort's figure.
it("renders a cohort roll-up card per GRAPH key, labelled as a partial sum, when the cohort has data", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({
    cohort: {
      period_keys: ["2026-05"],
      series: {
        revenue: [{ period_key: "2026-05", label: "May 2026", value: 10 }],
        burn: [], headcount: [], paying: [],
      },
    },
    startups: [{
      application_id: "a1", startup: "Acme Robotics", has_any_period: true,
      monthly_status: [{ period_key: "2026-05", label: "May 2026", status: "submitted", due_date: "2026-06-05", overdue: false }],
      latest_period: { period_key: "2026-05", label: "May 2026", submitted_at: "2026-05-20T00:00:00+00:00" },
      series: {
        revenue: [{ period_key: "2026-05", label: "May 2026", value: 10 }],
        burn: [], headcount: [], paying: [],
      },
    }],
  });
  const { container } = render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(container.querySelector(".mis-cohort-rollup")).toBeInTheDocument());
  const rollup = within(container.querySelector(".mis-cohort-rollup"));
  expect(rollup.getByTestId("card-revenue")).toBeInTheDocument();
  expect(rollup.getByTestId("card-burn")).toBeInTheDocument();
  expect(rollup.getByTestId("card-headcount")).toBeInTheDocument();
  expect(rollup.getByTestId("card-paying")).toBeInTheDocument();
  // Honest-label requirement: an unlabelled total invites a reader to treat
  // it as the whole cohort's figure, which it isn't.
  expect(screen.getByText(/partial sum/i)).toBeInTheDocument();
});

it("renders a per-startup latest-period line and its own chart grid when submitted data exists", async () => {
  adminVipApi.getMisCharts.mockResolvedValue({
    cohort: EMPTY_COHORT,
    startups: [{
      application_id: "a1", startup: "Acme Robotics", has_any_period: true,
      monthly_status: [{ period_key: "2026-05", label: "May 2026", status: "submitted", due_date: "2026-06-05", overdue: false }],
      latest_period: { period_key: "2026-05", label: "May 2026", submitted_at: "2026-05-20T00:00:00+00:00" },
      series: {
        revenue: [{ period_key: "2026-05", label: "May 2026", value: 10 }],
        burn: [], headcount: [], paying: [],
      },
    }],
  });
  const { container } = render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(screen.getByText("Acme Robotics")).toBeInTheDocument());
  expect(screen.getByText(/May 2026/)).toBeInTheDocument();
  const section = within(container.querySelector(".mis-startup-section"));
  expect(section.getByTestId("card-revenue")).toBeInTheDocument();
});

it("shows an error state with retry when the fetch fails", async () => {
  adminVipApi.getMisCharts.mockRejectedValue({ code: "boom", message: "Request failed" });
  render(<AdminVipMisCharts canWrite={false} />);
  await waitFor(() => expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
});
