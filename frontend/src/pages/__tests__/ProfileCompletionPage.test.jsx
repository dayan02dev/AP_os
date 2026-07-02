import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-router-dom", () => ({ useParams: () => ({ token: "tok123" }) }));
vi.mock("../../lib/profileCompletionApi.js", () => ({
  profileCompletionApi: { getState: vi.fn(), submit: vi.fn() },
}));
import { profileCompletionApi } from "../../lib/profileCompletionApi.js";
import ProfileCompletionPage from "../ProfileCompletionPage.jsx";

describe("ProfileCompletionPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows expired screen when the link is expired", async () => {
    profileCompletionApi.getState.mockResolvedValue({ valid: false, reason: "expired" });
    render(<ProfileCompletionPage />);
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument());
  });

  it("renders only the LinkedIn field when only LinkedIn is needed", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_resume: false, needs_linkedin: true, is_preview: false,
      applicant_name: "Asha", display_id: "TIR-26010",
    });
    render(<ProfileCompletionPage />);
    await waitFor(() => expect(screen.getByLabelText(/linkedin/i)).toBeInTheDocument());
    expect(screen.queryByText(/upload.*résumé|resume/i)).not.toBeInTheDocument();
  });

  it("shows a preview banner for preview tokens", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_resume: true, needs_linkedin: true, is_preview: true,
      applicant_name: "Applicant", display_id: "TIR — sample",
    });
    render(<ProfileCompletionPage />);
    await waitFor(() => expect(screen.getByText(/preview/i)).toBeInTheDocument());
  });

  it("submits and shows success", async () => {
    profileCompletionApi.getState.mockResolvedValue({
      valid: true, needs_resume: false, needs_linkedin: true, is_preview: false,
      applicant_name: "Asha", display_id: "TIR-26010",
    });
    profileCompletionApi.submit.mockResolvedValue({ ok: true, saved: { linkedin: true } });
    render(<ProfileCompletionPage />);
    await waitFor(() => screen.getByLabelText(/linkedin/i));
    fireEvent.change(screen.getByLabelText(/linkedin/i), { target: { value: "https://linkedin.com/in/asha" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/thank you|received|success/i)).toBeInTheDocument());
  });
});
