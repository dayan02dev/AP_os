import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProfilePills from "../ProfilePills.jsx";

describe("ProfilePills", () => {
  it("shows a clickable Résumé pill when a résumé file is present", () => {
    const onOpenResume = vi.fn();
    render(
      <ProfilePills
        resumeFile={{ storage_path: "u1/r.pdf" }}
        linkedinUrl={null}
        onOpenResume={onOpenResume}
      />,
    );
    const btn = screen.getByRole("button", { name: /Résumé/ });
    fireEvent.click(btn);
    expect(onOpenResume).toHaveBeenCalledTimes(1);
  });

  it("shows a muted, inert Résumé pill when absent", () => {
    render(<ProfilePills resumeFile={null} linkedinUrl={null} onOpenResume={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Résumé/ })).toBeNull();
    expect(screen.getByText(/Résumé/)).toBeInTheDocument();
  });

  it("renders a LinkedIn link (new tab) when a URL is present", () => {
    render(
      <ProfilePills resumeFile={null} linkedinUrl="linkedin.com/in/alice" onOpenResume={vi.fn()} />,
    );
    const a = screen.getByRole("link", { name: /LinkedIn/ });
    expect(a).toHaveAttribute("href", "https://linkedin.com/in/alice");
    expect(a).toHaveAttribute("target", "_blank");
  });

  it("shows a muted, inert LinkedIn pill when absent", () => {
    render(<ProfilePills resumeFile={null} linkedinUrl="" onOpenResume={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /LinkedIn/ })).toBeNull();
    expect(screen.getByText(/LinkedIn/)).toBeInTheDocument();
  });
});
