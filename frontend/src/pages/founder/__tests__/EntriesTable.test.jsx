import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EntriesTable from "../components/EntriesTable.jsx";

// Real field schemas transcribed from mis_catalog.ENTRY_FIELDS — deliberately
// not invented, matching the plan's "nothing hardcoded" proof convention.
const IP_ASSETS_FIELDS = [
  { key: "bucket", label: "Bucket", type: "choice", options: ["filed", "granted", "rejected", "international", "cumulative"] },
  { key: "category", label: "Category", type: "choice", options: ["patent", "design", "trademark", "copyright"] },
  { key: "title", label: "Title", type: "text" },
  { key: "filing_year", label: "Filing year", type: "int" },
];

const MILESTONES_FIELDS = [
  { key: "milestone", label: "Milestone", type: "text" },
  { key: "owner", label: "Owner", type: "text" },
  { key: "status", label: "Status", type: "choice", options: ["Done", "On Track", "At Risk", "Blocked"] },
  { key: "notes", label: "Notes", type: "text" },
];

const PUBLICATIONS_FIELDS = [
  { key: "bucket", label: "Bucket", type: "choice", options: ["published", "in_review", "standards_policy"] },
  { key: "title", label: "Title", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "peer_reviewed", label: "Peer reviewed", type: "bool" },
];

function row(id, sort_order, data) {
  return { id, period_id: "p1", section: "x", sort_order, data };
}

describe("EntriesTable", () => {
  it("renders one row per rows entry with each field's current data value", () => {
    const rows = [
      row("r1", 0, { milestone: "Ship v1", owner: "Asha", status: "Done", notes: "shipped" }),
      row("r2", 1, { milestone: "Pilot #2", owner: "Ravi", status: "On Track", notes: "" }),
    ];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Technical, Product & Regulatory Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={() => {}}
      />,
    );
    const rowEls = document.querySelectorAll(".mis-entries-row");
    expect(rowEls).toHaveLength(2);
    expect(within(rowEls[0]).getByLabelText("Milestone").value).toBe("Ship v1");
    expect(within(rowEls[0]).getByLabelText("Owner").value).toBe("Asha");
    expect(within(rowEls[1]).getByLabelText("Milestone").value).toBe("Pilot #2");
  });

  it("bucketed fixture: rows group under the right bucket headers in field.options order, a zero-row bucket still shows its header + E13 copy", () => {
    const rows = [
      row("r1", 0, { bucket: "granted", category: "patent", title: "Patent A", filing_year: 2024 }),
      row("r2", 1, { bucket: "filed", category: "design", title: "Design B", filing_year: 2025 }),
    ];
    render(
      <EntriesTable
        sectionId="ip_assets"
        title="IP Register"
        fields={IP_ASSETS_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={() => {}}
      />,
    );
    const buckets = document.querySelectorAll(".mis-entries-bucket");
    // 5 catalog buckets, in field.options order: filed, granted, rejected, international, cumulative
    expect(buckets).toHaveLength(5);
    const order = Array.from(buckets).map((b) => b.getAttribute("data-bucket"));
    expect(order).toEqual(["filed", "granted", "rejected", "international", "cumulative"]);

    const filedBucket = document.querySelector('[data-bucket="filed"]');
    expect(within(filedBucket).getByDisplayValue("Design B")).toBeInTheDocument();

    const rejectedBucket = document.querySelector('[data-bucket="rejected"]');
    expect(rejectedBucket.textContent).toContain("No rejected yet.");
    expect(rejectedBucket.querySelectorAll(".mis-entries-row")).toHaveLength(0);
  });

  it("flat fixture (milestones): no bucket headers appear anywhere", () => {
    const rows = [row("r1", 0, { milestone: "Ship v1", owner: "Asha", status: "Done", notes: "" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={() => {}}
      />,
    );
    expect(document.querySelectorAll(".mis-entries-bucket")).toHaveLength(0);
    expect(document.querySelectorAll(".mis-entries-bucket-head")).toHaveLength(0);
  });

  it("choice field renders a select bound to data[key]; changing it fires onSave with the updated array", () => {
    const onSave = vi.fn();
    const rows = [row("r1", 0, { milestone: "Ship v1", owner: "Asha", status: "On Track", notes: "" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    const select = screen.getByLabelText("Status");
    expect(select.value).toBe("On Track");
    fireEvent.change(select, { target: { value: "Done" } });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("milestones", [
      { milestone: "Ship v1", owner: "Asha", status: "Done", notes: "" },
    ]);
  });

  it("bool field (publications' peer_reviewed) renders three options; selecting \"—\" writes null, not false", () => {
    const onSave = vi.fn();
    const rows = [row("r1", 0, { bucket: "published", title: "Paper A", date: "2026-01-15", peer_reviewed: true })];
    render(
      <EntriesTable
        sectionId="publications"
        title="Publications"
        fields={PUBLICATIONS_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    const select = screen.getByLabelText("Peer reviewed");
    const optionTexts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(optionTexts).toEqual(["—", "Yes", "No"]);
    expect(select.value).toBe("true");

    fireEvent.change(select, { target: { value: "" } });
    expect(onSave).toHaveBeenCalledWith("publications", [
      { bucket: "published", title: "Paper A", date: "2026-01-15", peer_reviewed: null },
    ]);
    // Never collapsed to false:
    expect(onSave).not.toHaveBeenCalledWith(
      "publications",
      expect.arrayContaining([expect.objectContaining({ peer_reviewed: false })]),
    );
  });

  it("date field is a native date input; a value commits on change as the ISO string", () => {
    const onSave = vi.fn();
    const rows = [row("r1", 0, { bucket: "published", title: "Paper A", date: null, peer_reviewed: null })];
    render(
      <EntriesTable
        sectionId="publications"
        title="Publications"
        fields={PUBLICATIONS_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    const dateInput = screen.getByLabelText("Date");
    expect(dateInput.type).toBe("date");
    fireEvent.change(dateInput, { target: { value: "2026-03-20" } });
    expect(onSave).toHaveBeenCalledWith("publications", [
      { bucket: "published", title: "Paper A", date: "2026-03-20", peer_reviewed: null },
    ]);
  });

  it("a text field commits on blur only, not on every keystroke", () => {
    const onSave = vi.fn();
    const rows = [row("r1", 0, { milestone: "Ship v1", owner: "Asha", status: "On Track", notes: "" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    const notes = screen.getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "typing..." } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(notes);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("milestones", [
      { milestone: "Ship v1", owner: "Asha", status: "On Track", notes: "typing..." },
    ]);
  });

  it("THE LOAD-BEARING TEST: editing ONE field of ONE row in a 3-row fixture calls onSave with a 3-row array where the other two rows are byte-for-byte unchanged", () => {
    const onSave = vi.fn();
    const rows = [
      row("r1", 0, { milestone: "A", owner: "Asha", status: "Done", notes: "n1" }),
      row("r2", 1, { milestone: "B", owner: "Ravi", status: "On Track", notes: "n2" }),
      row("r3", 2, { milestone: "C", owner: "Priya", status: "Blocked", notes: "n3" }),
    ];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    const rowEls = document.querySelectorAll(".mis-entries-row");
    const middleOwner = within(rowEls[1]).getByLabelText("Owner");
    fireEvent.change(middleOwner, { target: { value: "Ravi K" } });
    fireEvent.blur(middleOwner);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [sectionArg, savedRows] = onSave.mock.calls[0];
    expect(sectionArg).toBe("milestones");
    expect(savedRows).toHaveLength(3);
    expect(savedRows[0]).toEqual({ milestone: "A", owner: "Asha", status: "Done", notes: "n1" });
    expect(savedRows[1]).toEqual({ milestone: "B", owner: "Ravi K", status: "On Track", notes: "n2" });
    expect(savedRows[2]).toEqual({ milestone: "C", owner: "Priya", status: "Blocked", notes: "n3" });
  });

  it("Add row calls onSave with rows.length + 1 entries, the new one all-null", () => {
    const onSave = vi.fn();
    const rows = [row("r1", 0, { milestone: "A", owner: "Asha", status: "Done", notes: "n1" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [, savedRows] = onSave.mock.calls[0];
    expect(savedRows).toHaveLength(2);
    expect(savedRows[0]).toEqual({ milestone: "A", owner: "Asha", status: "Done", notes: "n1" });
    expect(savedRows[1]).toEqual({ milestone: null, owner: null, status: null, notes: null });
  });

  it("Remove row calls onSave with rows.length - 1 entries, the removed one gone, others unchanged and in the same relative order", () => {
    const onSave = vi.fn();
    const rows = [
      row("r1", 0, { milestone: "A", owner: "Asha", status: "Done", notes: "n1" }),
      row("r2", 1, { milestone: "B", owner: "Ravi", status: "On Track", notes: "n2" }),
      row("r3", 2, { milestone: "C", owner: "Priya", status: "Blocked", notes: "n3" }),
    ];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove row 2/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const [, savedRows] = onSave.mock.calls[0];
    expect(savedRows).toEqual([
      { milestone: "A", owner: "Asha", status: "Done", notes: "n1" },
      { milestone: "C", owner: "Priya", status: "Blocked", notes: "n3" },
    ]);
  });

  it("empty + isFirstPeriod true renders E11 copy containing the fixture's title verbatim", () => {
    render(
      <EntriesTable
        sectionId="milestones"
        title="Zorbatron Milestones"
        fields={MILESTONES_FIELDS}
        rows={[]}
        isFirstPeriod={true}
        disabled={false}
        onSave={() => {}}
      />,
    );
    expect(
      screen.getByText("No Zorbatron Milestones yet — this is your first reporting period. Add one below."),
    ).toBeInTheDocument();
  });

  it("empty + isFirstPeriod false renders E12 copy, distinct from E11's", () => {
    render(
      <EntriesTable
        sectionId="milestones"
        title="Zorbatron Milestones"
        fields={MILESTONES_FIELDS}
        rows={[]}
        isFirstPeriod={false}
        disabled={false}
        onSave={() => {}}
      />,
    );
    expect(
      screen.getByText("Nothing here for this period yet. Add a row if there's something new."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/first reporting period/i)).not.toBeInTheDocument();
  });

  it("disabled: every field control is non-interactive; Add/Remove controls are not rendered at all", () => {
    const rows = [row("r1", 0, { milestone: "A", owner: "Asha", status: "Done", notes: "n1" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={MILESTONES_FIELDS}
        rows={rows}
        isFirstPeriod={false}
        disabled={true}
        onSave={() => {}}
      />,
    );
    expect(screen.getByLabelText("Milestone")).toBeDisabled();
    expect(screen.getByLabelText("Owner")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();
    expect(screen.getByLabelText("Notes")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /add row/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove row/i })).not.toBeInTheDocument();
  });

  it("renaming a field's label in the fixture makes the new text appear (catalog-driven proof)", () => {
    const renamed = MILESTONES_FIELDS.map((f) =>
      f.key === "milestone" ? { ...f, label: "Zorbatron Milestone Text" } : f,
    );
    const rows = [row("r1", 0, { milestone: "A", owner: "Asha", status: "Done", notes: "n1" })];
    render(
      <EntriesTable
        sectionId="milestones"
        title="Milestones"
        fields={renamed}
        rows={rows}
        isFirstPeriod={false}
        disabled={false}
        onSave={() => {}}
      />,
    );
    expect(screen.getByLabelText("Zorbatron Milestone Text")).toBeInTheDocument();
    expect(screen.queryByLabelText("Milestone")).not.toBeInTheDocument();
  });
});
