import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PeriodPicker from "../components/PeriodPicker.jsx";

const PERIODS = [
  { period_key: "2026-06", label: "Jun 2026", status: "submitted", due_date: "2026-07-05", overdue: false },
  { period_key: "2026-07", label: "Jul 2026", status: "draft", due_date: "2026-08-05", overdue: true },
  { period_key: "2026-08", label: "Aug 2026", status: "draft", due_date: "2026-09-05", overdue: false },
];

describe("PeriodPicker", () => {
  it("renders periods in the given order, not reversed", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const labels = screen.getAllByText(/2026$/).map((el) => el.textContent);
    expect(labels).toEqual(["Jun 2026", "Jul 2026", "Aug 2026"]);
  });

  it("shows Submitted for a submitted period, no Draft/Overdue chip", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Jun 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Submitted");
    expect(row).not.toHaveTextContent("Draft");
    expect(row).not.toHaveTextContent("Overdue");
  });

  it("shows Overdue instead of Draft for an overdue draft period", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Jul 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Overdue");
    expect(row).not.toHaveTextContent(/^Draft$/);
  });

  it("shows plain Draft for a non-overdue draft period", () => {
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={() => {}} />);
    const row = screen.getByText("Aug 2026").closest("[data-period-key]");
    expect(row).toHaveTextContent("Draft");
    expect(row).not.toHaveTextContent("Overdue");
  });

  it("marks the selected period and calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<PeriodPicker kind="monthly" periods={PERIODS} selectedKey="2026-07" onSelect={onSelect} />);
    const selected = screen.getByText("Jul 2026").closest("[data-period-key]");
    expect(selected).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByText("Aug 2026"));
    expect(onSelect).toHaveBeenCalledWith("2026-08");
  });

  it("renders the empty-calendar copy and nothing else when periods is empty", () => {
    render(<PeriodPicker kind="monthly" periods={[]} selectedKey={null} onSelect={() => {}} />);
    expect(screen.getByText(/No monthly periods yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
