import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeclineAssignmentModal from "../scoring/DeclineAssignmentModal.jsx";

describe("DeclineAssignmentModal", () => {
  it("disables submit when reason is under 10 chars", async () => {
    const onConfirm = vi.fn();
    render(<DeclineAssignmentModal assignmentId="a1" onConfirm={onConfirm} onCancel={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/i), "no");
    expect(screen.getByRole("button", { name: /Decline assignment/i })).toBeDisabled();
  });

  it("enables submit at ≥10 chars and calls onConfirm with the reason", async () => {
    const onConfirm = vi.fn();
    render(<DeclineAssignmentModal assignmentId="a1" onConfirm={onConfirm} onCancel={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Reason/i), "Not my domain expertise.");
    const btn = screen.getByRole("button", { name: /Decline assignment/i });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(onConfirm).toHaveBeenCalledWith("Not my domain expertise.");
  });
});
