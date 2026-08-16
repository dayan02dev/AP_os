import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import MetricsGrid from "../components/MetricsGrid.jsx";

// Real catalog shape (mis_catalog.py METRIC_GROUPS / METRICS), transcribed
// verbatim so this fixture exercises the actual 13-key / 4-group template,
// plus one carried-forward custom row (E10).
const GROUPS = [
  { key: "commercial", label: "Commercial" },
  { key: "product_technology", label: "Product / Technology" },
  { key: "financials", label: "Financials" },
  { key: "team", label: "Team" },
];

const row = (over) => ({
  id: "row-" + over.metric_key,
  period_id: "p1",
  metric_key: over.metric_key,
  label: over.label,
  group_key: over.group_key,
  unit: over.unit || "",
  target: over.target ?? null,
  actual: over.actual ?? null,
  prev_actual: over.prev_actual ?? null,
  rag: over.rag ?? null,
  commentary: over.commentary ?? null,
  is_custom: over.is_custom ?? false,
  sort_order: over.sort_order ?? 0,
});

const METRICS = [
  row({ metric_key: "revenue_month", label: "Revenue this month (₹ Lakh)", group_key: "commercial", unit: "₹L", target: 10, actual: 12, rag: "green", commentary: "On track" }),
  row({ metric_key: "active_customers", label: "Active paying customers / pilots", group_key: "commercial", unit: "count", target: 5, actual: 4 }),
  row({ metric_key: "new_lois", label: "New LOIs / MoUs signed", group_key: "commercial", unit: "count" }),
  row({ metric_key: "weighted_pipeline", label: "Weighted pipeline (₹ Lakh)", group_key: "commercial", unit: "₹L" }),
  row({ metric_key: "deployments_field", label: "Deployments in field", group_key: "product_technology", unit: "count" }),
  row({ metric_key: "product_metric_1", label: "Key product metric #1", group_key: "product_technology", unit: "free" }),
  row({ metric_key: "product_metric_2", label: "Key product metric #2", group_key: "product_technology", unit: "free" }),
  row({ metric_key: "trl_level", label: "TRL Level (1–9)", group_key: "product_technology", unit: "1–9", actual: 6 }),
  row({ metric_key: "cash_in_bank", label: "Cash in bank (₹ Cr)", group_key: "financials", unit: "₹Cr" }),
  row({ metric_key: "net_burn_month", label: "Net burn / month (₹ Lakh)", group_key: "financials", unit: "₹L" }),
  row({ metric_key: "runway_months", label: "Runway (months)", group_key: "financials", unit: "months" }),
  row({ metric_key: "headcount_eom", label: "Headcount (end of month)", group_key: "team", unit: "count" }),
  row({ metric_key: "net_hires_month", label: "Net hires this month", group_key: "team", unit: "count" }),
  row({ metric_key: "legacy_kpi_x", label: "Legacy custom KPI", group_key: "commercial", unit: "count", is_custom: true, actual: 3 }),
];

function findRow(container, key) {
  return container.querySelector(`[data-metric-key="${key}"]`);
}

describe("MetricsGrid", () => {
  it("renders all 13 catalog metrics under their 4 group headers, in catalog order", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    const headers = container.querySelectorAll(".mis-metric-group-label");
    expect(Array.from(headers).map((h) => h.textContent)).toEqual([
      "Commercial", "Product / Technology", "Financials", "Team",
    ]);
    for (const m of METRICS.filter((r) => !r.is_custom)) {
      expect(findRow(container, m.metric_key)).toBeTruthy();
    }
  });

  it("trl_level renders no input anywhere, in both disabled=false and disabled=true", () => {
    for (const disabled of [false, true]) {
      const { container, unmount } = render(
        <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} disabled={disabled} onChange={() => {}} />,
      );
      const trlRow = findRow(container, "trl_level");
      expect(trlRow.querySelectorAll("input, select, textarea").length).toBe(0);
      unmount();
    }
  });

  it("trl_level with actual: 6 shows \"6\"; with actual: null shows the exact E9 copy", () => {
    const { container, rerender } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    expect(findRow(container, "trl_level")).toHaveTextContent("6");

    const withNullTrl = METRICS.map((m) => (m.metric_key === "trl_level" ? { ...m, actual: null } : m));
    rerender(<MetricsGrid metrics={withNullTrl} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />);
    expect(findRow(container, "trl_level")).toHaveTextContent(
      "Populated automatically once ARTPARK has verified all six AIR levers this quarter.",
    );
  });

  it("the custom row renders read-only with the exact E10 copy, and is never targeted by an editable control", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    const customRow = findRow(container, "legacy_kpi_x");
    expect(customRow).toBeTruthy();
    expect(customRow).toHaveTextContent("Carried forward from an earlier period. Contact ARTPARK to update it.");
    expect(customRow.querySelectorAll("input, select, textarea").length).toBe(0);
  });

  it("vs_last: actual present, vs_last null, first period -> E6 copy", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{ revenue_month: null }} isFirstPeriod onChange={() => {}} />,
    );
    expect(findRow(container, "revenue_month")).toHaveTextContent("First reporting period — nothing to compare yet.");
  });

  it("vs_last: actual present, vs_last null, NOT first period -> E7 copy (differs from E6)", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{ revenue_month: null }} isFirstPeriod={false} onChange={() => {}} />,
    );
    expect(findRow(container, "revenue_month")).toHaveTextContent("No comparable figure last period.");
    expect(findRow(container, "revenue_month")).not.toHaveTextContent("First reporting period");
  });

  it("vs_last: exactly 0 renders \"0\", not E7's copy", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{ revenue_month: 0 }} isFirstPeriod={false} onChange={() => {}} />,
    );
    const r = findRow(container, "revenue_month");
    expect(r).toHaveTextContent("0");
    expect(r).not.toHaveTextContent("No comparable figure last period.");
  });

  it("vs_last: actual null renders no vs_last content at all, regardless of vs_last value", () => {
    const withNullActual = METRICS.map((m) => (m.metric_key === "revenue_month" ? { ...m, actual: null } : m));
    const { container } = render(
      <MetricsGrid metrics={withNullActual} metricGroups={GROUPS} vsLast={{ revenue_month: 7 }} isFirstPeriod={false} onChange={() => {}} />,
    );
    const r = findRow(container, "revenue_month");
    expect(r.querySelector(".mis-vs-last")).toBeNull();
  });

  it("editing actual commits on blur only, with the typed value as a number", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={onChange} />,
    );
    const r = findRow(container, "active_customers");
    const actualInput = within(r).getByLabelText("Actual");
    fireEvent.change(actualInput, { target: { value: "9" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(actualInput);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("active_customers", "actual", 9);
  });

  it("clearing actual on blur calls onChange(key, \"actual\", null)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={onChange} />,
    );
    const r = findRow(container, "active_customers");
    const actualInput = within(r).getByLabelText("Actual");
    fireEvent.change(actualInput, { target: { value: "" } });
    fireEvent.blur(actualInput);
    expect(onChange).toHaveBeenCalledWith("active_customers", "actual", null);
  });

  it("RAG select commits immediately on change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={onChange} />,
    );
    const r = findRow(container, "active_customers");
    const ragSelect = within(r).getByLabelText("RAG");
    fireEvent.change(ragSelect, { target: { value: "amber" } });
    expect(onChange).toHaveBeenCalledWith("active_customers", "rag", "amber");
  });

  it("product_metric_1's label is an editable input; revenue_month's label is plain text", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    const pm1Row = findRow(container, "product_metric_1");
    expect(within(pm1Row).getByLabelText("Label")).toBeInTheDocument();

    const revRow = findRow(container, "revenue_month");
    expect(within(revRow).queryByLabelText("Label")).not.toBeInTheDocument();
    expect(revRow).toHaveTextContent("Revenue this month (₹ Lakh)");
  });

  it("disabled disables every editable control", () => {
    const { container } = render(
      <MetricsGrid metrics={METRICS} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} disabled onChange={() => {}} />,
    );
    const editableRows = METRICS.filter((m) => m.metric_key !== "trl_level" && !m.is_custom);
    for (const m of editableRows) {
      const r = findRow(container, m.metric_key);
      const controls = r.querySelectorAll("input, select, textarea");
      expect(controls.length).toBeGreaterThan(0);
      for (const c of controls) expect(c).toBeDisabled();
    }
  });

  it("a row with an unrecognised group_key renders under an Other fallback group, not silently dropped", () => {
    const withOrphan = [...METRICS, row({ metric_key: "orphan_kpi", label: "Orphan KPI", group_key: "not_a_real_group", is_custom: true, actual: 1 })];
    const { container } = render(
      <MetricsGrid metrics={withOrphan} metricGroups={GROUPS} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    const headers = Array.from(container.querySelectorAll(".mis-metric-group-label")).map((h) => h.textContent);
    expect(headers).toContain("Other");
    expect(findRow(container, "orphan_kpi")).toBeTruthy();
  });

  it("catalog-driven: renaming a metric's label and a group's label makes the new text appear", () => {
    const renamedMetrics = METRICS.map((m) =>
      m.metric_key === "cash_in_bank" ? { ...m, label: "Totally reworded metric label" } : m,
    );
    const renamedGroups = GROUPS.map((g) => (g.key === "financials" ? { ...g, label: "Totally reworded group label" } : g));
    render(
      <MetricsGrid metrics={renamedMetrics} metricGroups={renamedGroups} vsLast={{}} isFirstPeriod={false} onChange={() => {}} />,
    );
    expect(screen.getByText("Totally reworded metric label")).toBeInTheDocument();
    expect(screen.getByText("Totally reworded group label")).toBeInTheDocument();
    expect(screen.queryByText("Cash in bank (₹ Cr)")).not.toBeInTheDocument();
    expect(screen.queryByText("Financials")).not.toBeInTheDocument();
  });
});
