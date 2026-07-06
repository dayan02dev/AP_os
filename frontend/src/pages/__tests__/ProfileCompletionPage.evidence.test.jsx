import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-router-dom", () => ({ useParams: () => ({ token: "tok123" }) }));
vi.mock("../../lib/profileCompletionApi.js", () => ({
  profileCompletionApi: { getState: vi.fn(), submit: vi.fn(), submitEvidence: vi.fn() },
}));
import { profileCompletionApi } from "../../lib/profileCompletionApi.js";
import ProfileCompletionPage from "../ProfileCompletionPage.jsx";

function file(name, type) {
  return new File(["x"], name, { type });
}

describe("ProfileCompletionPage — evidence re-collection mode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a multiple file input for an evidence token", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_evidence: true, applicant_name: "A", display_id: "TIR-1",
    });
    render(<ProfileCompletionPage />);
    await waitFor(() => {
      const input = document.querySelector('input[type="file"]');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("multiple");
    });
  });

  it("does not mention résumé/LinkedIn in evidence-mode copy, and uses the evidence explanation", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_evidence: true, applicant_name: "A", display_id: "TIR-1",
    });
    render(<ProfileCompletionPage />);
    await waitFor(() => expect(screen.getByText(/technical issues/i)).toBeInTheDocument());
    expect(screen.queryByText(/résumé|resume|linkedin/i)).not.toBeInTheDocument();
  });

  it("disables Submit until at least one file is selected, then submits via submitEvidence", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_evidence: true, applicant_name: "A", display_id: "TIR-1",
    });
    profileCompletionApi.submitEvidence.mockResolvedValue({ ok: true, saved: { added: 2, pruned: 0, kept: 0 } });
    render(<ProfileCompletionPage />);

    await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]');
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();

    const files = [file("a.pdf", "application/pdf"), file("b.jpg", "image/jpeg")];
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(screen.getByText(/2 file\(s\) selected/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /submit/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(profileCompletionApi.submitEvidence).toHaveBeenCalledTimes(1));
    const [tokenArg, filesArg] = profileCompletionApi.submitEvidence.mock.calls[0];
    expect(tokenArg).toBe("tok123");
    expect(Array.from(filesArg).map((f) => f.name)).toEqual(["a.pdf", "b.jpg"]);
    expect(profileCompletionApi.submit).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText(/thank you|received|success/i)).toBeInTheDocument());
  });
});
