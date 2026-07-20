import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

describe("FounderPortal shell", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the gated message on 403", async () => {
    vi.spyOn(founderApi, "me").mockRejectedValue({ status: 403 });
    render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/unlocks once your TIR application is selected/i)).toBeInTheDocument());
  });

  it("renders the sidebar groups when onboarded", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({
      status: "onboarded", project_name: "Neonatal monitor", mou_signed: true,
      locked: { cohort: false, dashboard: false },
    });
    render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
    expect(screen.getByText("Cohort management")).toBeInTheDocument();
  });
});
