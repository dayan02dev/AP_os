import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SipTemplateScreen } from "../SipTemplateScreen.jsx";

vi.mock("../../hooks/useSipTemplate.js", () => ({
  useSipTemplate: vi.fn(() => ({
    template: null,
    uploading: false,
    parsing: false,
    applying: false,
    applyResult: null,
    error: null,
    upload: vi.fn(),
    apply: vi.fn(),
  })),
}));

describe("<SipTemplateScreen/>", () => {
  it("renders the SIP template download link with correct href", () => {
    render(<SipTemplateScreen onContinue={() => {}} onBack={() => {}} />);
    const link = screen.getByRole("link", { name: /download template/i });
    expect(link).toHaveAttribute(
      "href",
      "/templates/ARTPARK_SIP_Application_Template.docx?v=1",
    );
  });

  it("calls onContinue when the action button is clicked", () => {
    const onContinue = vi.fn();
    render(<SipTemplateScreen onContinue={onContinue} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /skip|continue/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("file input accepts .docx and .pdf", () => {
    render(<SipTemplateScreen onContinue={() => {}} onBack={() => {}} />);
    const input = screen.getByTestId("sip-template-file-input");
    expect(input).toHaveAttribute("accept", ".docx,.pdf");
  });
});
