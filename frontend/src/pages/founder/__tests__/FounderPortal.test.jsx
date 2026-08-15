import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";

vi.mock("../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "founder@x.com", roles: [] }, logout: () => Promise.resolve() }),
}));

const me = (track) => ({
  status: "onboarded", track, project_name: "Neonatal monitor", mou_signed: true,
  locked: { cohort: false, dashboard: false },
});

const renderPortal = () =>
  render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);

describe("FounderPortal shell", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a track-neutral gated message on 403", async () => {
    vi.spyOn(founderApi, "me").mockRejectedValue({ status: 403 });
    renderPortal();
    await waitFor(() =>
      expect(screen.getByText(/unlocks once your application is selected/i)).toBeInTheDocument());
  });

  it("renders the TIR cohort group for a tir founder", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me("tir"));
    renderPortal();
    await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
    expect(screen.getByText("Cohort management")).toBeInTheDocument();
    expect(screen.getByText("Approach")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.getByText("Expense management")).toBeInTheDocument();
    expect(screen.queryByText("TLR evaluation")).not.toBeInTheDocument();
  });

  it("renders the VIP cohort group for a sip founder", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue(me("sip"));
    renderPortal();
    await waitFor(() => expect(screen.getByText("TLR evaluation")).toBeInTheDocument());
    expect(screen.getByText("MIS filling")).toBeInTheDocument();
    expect(screen.queryByText("Approach")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Expense management")).not.toBeInTheDocument();
  });

  it("keeps Current, Sign MOU and all five Founders Resources on both tracks", async () => {
    for (const track of ["tir", "sip"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(track));
      const { unmount } = renderPortal();
      await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
      for (const label of ["Current", "Art Infra", "ArtConnect", "ArtPartners", "Art Assets", "Art Support"]) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      unmount();
    }
  });

  it("no longer renders the Cohort links group on either track", async () => {
    for (const track of ["tir", "sip"]) {
      vi.spyOn(founderApi, "me").mockResolvedValue(me(track));
      const { unmount } = renderPortal();
      await waitFor(() => expect(screen.getByText("Sign MOU")).toBeInTheDocument());
      expect(screen.queryByText("Cohort")).not.toBeInTheDocument();
      expect(screen.queryByText("Programs")).not.toBeInTheDocument();
      expect(screen.queryByText("TIR overview")).not.toBeInTheDocument();
      expect(screen.queryByText("VIP overview")).not.toBeInTheDocument();
      unmount();
    }
  });
});
