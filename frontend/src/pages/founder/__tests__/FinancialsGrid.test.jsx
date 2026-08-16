import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FinancialsGrid from "../components/FinancialsGrid.jsx";

// Transcribed from mis_catalog.FINANCIAL_SERIES / FINANCIAL_BUCKETS — not
// invented. The annual-revenue bucket labels are deliberately a
// non-sequential-looking set (an offset FY range with YTD/Proj on the end)
// so the "renders verbatim, never recomputed" test means something: a
// component that tried to derive its own FY sequence from `Date.now()`
// would produce a DIFFERENT list than this fixture's.
const FINANCIAL_SERIES = {
  annual_revenue: [
    { key: "annual_revenue_booked", label: "Revenue: orders / paid pilots on books" },
    { key: "annual_revenue_received", label: "Revenue: payment received" },
  ],
  needs: [
    { key: "needs_total", label: "Total needs" },
    { key: "needs_confirmed", label: "Confirmed funding" },
    { key: "needs_projected", label: "Projected (likely, not confirmed)" },
    { key: "needs_gap", label: "Gap" },
  ],
};

const FINANCIAL_BUCKETS = {
  annual_revenue: ["FY22-23", "FY23-24", "FY24-25", "FY25-26", "FY26-27 YTD", "FY26-27 Proj"],
  needs: ["Q1 (Current)", "Q2 (Next)", "Q3", "Q4", "Q5"],
};

function financialsRow(series, bucket, amount) {
  return { id: `${series}-${bucket}`, period_id: "p1", series, bucket, amount, sort_order: 0 };
}

describe("FinancialsGrid", () => {
  it("renders the 6 annual-revenue bucket labels exactly as given, nothing recomputed", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={() => {}}
      />,
    );
    for (const label of FINANCIAL_BUCKETS.annual_revenue) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // Not a component-invented sequence starting at FY21-22 (the template's
    // own stale example) or any other year:
    expect(screen.queryByText("FY21-22")).not.toBeInTheDocument();
  });

  it("renders the 5 needs buckets from the fixture", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={() => {}}
      />,
    );
    for (const label of FINANCIAL_BUCKETS.needs) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("Gap row shows E14 copy when needsGap[bucket] is null", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{ "Q1 (Current)": null }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getAllByText("Shows once Total, Confirmed and Projected are all filled in.").length,
    ).toBeGreaterThan(0);
  });

  it("Gap row shows literal \"0\" when needsGap[bucket] is 0, not E14's copy", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{
          "Q1 (Current)": 0,
          "Q2 (Next)": null,
          Q3: null,
          Q4: null,
          Q5: null,
        }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const gapRow = document.querySelector(".mis-gap-row");
    const cells = gapRow.querySelectorAll(".mis-gap-cell");
    expect(cells[0].textContent).toBe("0");
    expect(cells[0].textContent).not.toContain("Shows once");
    expect(cells[1].textContent).toContain("Shows once");
  });

  it("Gap row contains no <input> anywhere", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{ "Q1 (Current)": 5000 }}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const gapRow = document.querySelector(".mis-gap-row");
    expect(gapRow.querySelectorAll("input")).toHaveLength(0);
  });

  it("editing an annual-revenue cell calls onChange with the right series", () => {
    const onChange = vi.fn();
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Revenue: orders / paid pilots on books — FY24-25");
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("annual_revenue_booked", "FY24-25", 42);
  });

  it("editing a needs cell calls onChange with the right series", () => {
    const onChange = vi.fn();
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Confirmed funding — Q3");
    fireEvent.change(input, { target: { value: "15.5" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("needs_confirmed", "Q3", 15.5);
  });

  it("clearing a cell on blur calls onChange with null", () => {
    const onChange = vi.fn();
    render(
      <FinancialsGrid
        financials={[financialsRow("needs_total", "Q1 (Current)", 100)]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Total needs — Q1 (Current)");
    expect(input.value).toBe("100");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("needs_total", "Q1 (Current)", null);
  });

  it("disabled disables the editable inputs and leaves the (already non-interactive) Gap row unchanged", () => {
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={FINANCIAL_SERIES}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{ "Q1 (Current)": 10 }}
        disabled={true}
        onChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Total needs — Q1 (Current)");
    expect(input).toBeDisabled();
    const gapRow = document.querySelector(".mis-gap-row");
    expect(gapRow.querySelectorAll("input")).toHaveLength(0);
    expect(gapRow.textContent).toContain("10");
  });

  it("renaming a series label in the fixture makes the new text appear", () => {
    const renamed = {
      ...FINANCIAL_SERIES,
      needs: FINANCIAL_SERIES.needs.map((r) =>
        r.key === "needs_confirmed" ? { ...r, label: "Zorbatron Confirmed Funding" } : r,
      ),
    };
    render(
      <FinancialsGrid
        financials={[]}
        financialSeries={renamed}
        financialBuckets={FINANCIAL_BUCKETS}
        needsGap={{}}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Zorbatron Confirmed Funding")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed funding")).not.toBeInTheDocument();
  });
});
