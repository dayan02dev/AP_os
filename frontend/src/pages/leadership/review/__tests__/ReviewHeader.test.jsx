import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewHeader from "../ReviewHeader.jsx";

const baseProps = {
  appId: "SIP-2026-aae677aa",
  status: null,
  scoreOverall: 8.5,
  onBack: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  hasPrev: false,
  hasNext: false,
  onToggleAside: vi.fn(),
  asideCollapsed: false,
};

describe("ReviewHeader Export PDF button", () => {
  it("is enabled and calls onExport when canExport is true", async () => {
    const onExport = vi.fn();
    render(<ReviewHeader {...baseProps} onExport={onExport} canExport={true} />);
    const btn = screen.getByRole("button", { name: /Export PDF/i });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("is disabled and does not call onExport when canExport is false", async () => {
    const onExport = vi.fn();
    render(<ReviewHeader {...baseProps} onExport={onExport} canExport={false} />);
    const btn = screen.getByRole("button", { name: /Export PDF/i });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onExport).not.toHaveBeenCalled();
  });
});
