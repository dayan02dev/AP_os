import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

const me = (locked) => ({
  status: locked ? "offered" : "onboarded", track: "sip",
  project_name: "Dharini", mou_signed: !locked,
  locked: { cohort: locked, dashboard: locked },
});

describe("VIP cohort tabs", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the TLR evaluation screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    render(<MemoryRouter><FounderPortal tab="tlr" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/ARTPARK Innovation Readiness/i)).toBeInTheDocument());
  });

  it("renders the MIS screen", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me(false));
    render(<MemoryRouter><FounderPortal tab="mis" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Monthly and quarterly reporting/i)).toBeInTheDocument());
  });

  it("locks both VIP tabs until the MOU is signed", async () => {
    for (const tab of ["tlr", "mis"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(true));
      const { unmount } = render(<MemoryRouter><FounderPortal tab={tab} /></MemoryRouter>);
      await waitFor(() => expect(screen.getByText(/sign your MOU/i)).toBeInTheDocument());
      unmount();
    }
  });
});
