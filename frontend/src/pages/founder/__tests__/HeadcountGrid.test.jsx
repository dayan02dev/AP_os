import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HeadcountGrid from "../components/HeadcountGrid.jsx";

// Transcribed from mis_catalog.HEADCOUNT_CATEGORIES — not invented.
const HEADCOUNT_CATEGORIES = [
  { key: "artpark_associated", label: "Employees (ARTPARK, associated with startup)" },
  { key: "startup", label: "Employees (Startup, not ARTPARK)" },
  { key: "consultants", label: "Consultants" },
  { key: "interns", label: "Interns" },
];

function headcountRow(category, current_count, exited, remarks = null) {
  return { id: category, period_id: "p1", category, current_count, exited, remarks };
}

describe("HeadcountGrid", () => {
  it("renders exactly 4 category rows + 1 Total row, in catalog order, Total last", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const rows = document.querySelectorAll(".mis-headcount-row");
    expect(rows).toHaveLength(5);
    const cats = Array.from(rows).map((r) => r.getAttribute("data-category"));
    expect(cats).toEqual(["artpark_associated", "startup", "consultants", "interns", "__total__"]);
  });

  it("Total row contains zero <input> elements", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const totalRow = document.querySelector('[data-category="__total__"]');
    expect(totalRow.querySelectorAll("input")).toHaveLength(0);
  });

  it("category net_change null + isFirstPeriod true renders E16 copy", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: { artpark_associated: null }, total: { current_count: null, exited: null } }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const row = document.querySelector('[data-category="artpark_associated"]');
    expect(row.textContent).toContain("No prior quarter to compare.");
  });

  it("category net_change null + isFirstPeriod false renders E17 copy, distinct from E16's", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: { artpark_associated: null }, total: { current_count: null, exited: null } }}
        isFirstPeriod={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const row = document.querySelector('[data-category="artpark_associated"]');
    expect(row.textContent).toContain("Last quarter's headcount wasn't recorded.");
    expect(row.textContent).not.toContain("No prior quarter to compare.");
  });

  it("category net_change 0 renders literal \"0\"", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: { consultants: 0 }, total: { current_count: null, exited: null } }}
        isFirstPeriod={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const row = document.querySelector('[data-category="consultants"]');
    const cell = row.querySelector(".mis-net-change");
    expect(cell.textContent).toBe("0");
  });

  it("category net_change -3 renders the minus sign, not dropped", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: { interns: -3 }, total: { current_count: null, exited: null } }}
        isFirstPeriod={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const row = document.querySelector('[data-category="interns"]');
    const cell = row.querySelector(".mis-net-change");
    expect(cell.textContent).toBe("-3");
  });

  it("HIGHEST-VALUE TEST: the Total row's net_change cell has empty text content — not \"—\", not any string", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{
          net_change: {
            artpark_associated: null,
            startup: null,
            consultants: null,
            interns: null,
          },
          total: { current_count: null, exited: null },
        }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const totalRow = document.querySelector('[data-category="__total__"]');
    const cell = totalRow.querySelector(".mis-net-change");
    expect(cell.textContent).toBe("");
    expect(cell.textContent).not.toBe("—");
  });

  it("Total current_count null (all 4 categories blank) renders \"—\"", () => {
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const totalRow = document.querySelector('[data-category="__total__"]');
    const cells = totalRow.querySelectorAll(".mis-headcount-cell");
    expect(cells[0].textContent).toBe("—");
    expect(cells[1].textContent).toBe("—");
  });

  it("Total current_count is a real partial sum: renders derived.headcount.total exactly, never a client-recomputed sum", () => {
    // Deliberately: if this component summed the 4 category rows itself
    // (3 + null + 5 + null -> 8), it would render 8. `derived.headcount.total`
    // says 99 instead — a value that only appears if the derived value is
    // rendered as given.
    const headcount = [
      headcountRow("artpark_associated", 3, 0),
      headcountRow("startup", null, null),
      headcountRow("consultants", 5, 1),
      headcountRow("interns", null, null),
    ];
    render(
      <HeadcountGrid
        headcount={headcount}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: 99, exited: 1 } }}
        isFirstPeriod={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const totalRow = document.querySelector('[data-category="__total__"]');
    const cells = totalRow.querySelectorAll(".mis-headcount-cell");
    expect(cells[0].textContent).toBe("99");
    expect(cells[1].textContent).toBe("1");
  });

  it("editing current_count/exited on a category row commits on blur", () => {
    const onChange = vi.fn();
    const headcount = [headcountRow("consultants", 5, 1)];
    render(
      <HeadcountGrid
        headcount={headcount}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={false}
        disabled={false}
        onChange={onChange}
      />,
    );
    const currentCountInput = screen.getByLabelText("Consultants — Current count");
    fireEvent.change(currentCountInput, { target: { value: "7" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(currentCountInput);
    expect(onChange).toHaveBeenCalledWith("consultants", "current_count", 7);

    const exitedInput = screen.getByLabelText("Consultants — Exited this quarter");
    fireEvent.change(exitedInput, { target: { value: "" } });
    fireEvent.blur(exitedInput);
    expect(onChange).toHaveBeenCalledWith("consultants", "exited", null);
  });

  it("disabled disables every category-row input", () => {
    const headcount = [headcountRow("consultants", 5, 1)];
    render(
      <HeadcountGrid
        headcount={headcount}
        headcountCategories={HEADCOUNT_CATEGORIES}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={false}
        disabled={true}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Consultants — Current count")).toBeDisabled();
    expect(screen.getByLabelText("Consultants — Exited this quarter")).toBeDisabled();
    expect(screen.getByLabelText("Consultants — Remarks")).toBeDisabled();
  });

  it("renaming a category label makes the new text appear", () => {
    const renamed = HEADCOUNT_CATEGORIES.map((c) =>
      c.key === "consultants" ? { ...c, label: "Zorbatron Consultants" } : c,
    );
    render(
      <HeadcountGrid
        headcount={[]}
        headcountCategories={renamed}
        derived={{ net_change: {}, total: { current_count: null, exited: null } }}
        isFirstPeriod={true}
        disabled={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Zorbatron Consultants")).toBeInTheDocument();
    expect(screen.queryByText("Consultants")).not.toBeInTheDocument();
  });
});
