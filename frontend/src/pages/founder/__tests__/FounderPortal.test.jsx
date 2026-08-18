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

  // ── Founders Resources lock: sidebar + route guard, distinct copy ──────

  it("disables a locked resource item in the sidebar", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({
      status: "onboarded", locked: { cohort: false, dashboard: false },
      resources_available: { store: false, fundraising: true, partners: false, assets: false, support: false },
    });
    render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Art Infra")).toBeInTheDocument());
    expect(screen.getByText("Art Infra").closest("button")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("ArtConnect").closest("button")).not.toHaveAttribute("aria-disabled");
  });

  it("blocks direct navigation to a locked resource tab — the guard, not just the sidebar", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({
      status: "onboarded", locked: { cohort: false, dashboard: false },
      resources_available: { store: false, fundraising: false, partners: false, assets: false, support: false },
    });
    const getStoreSpy = vi.spyOn(founderApi, "getStore");
    render(<MemoryRouter initialEntries={["/founder/store"]}><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/isn't open yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/procurement store/i)).not.toBeInTheDocument();
    expect(getStoreSpy).not.toHaveBeenCalled();
  });

  it("opens a resource tab once its flag is true", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({
      status: "onboarded", locked: { cohort: false, dashboard: false },
      resources_available: { store: true, fundraising: false, partners: false, assets: false, support: false },
    });
    vi.spyOn(founderApi, "getStore").mockResolvedValue({ catalog: [], cart: [], cart_subtotal: 0 });
    render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
  });

  it("FounderResourceLocked copy is not the MOU-lock copy", async () => {
    vi.spyOn(founderApi, "me").mockResolvedValue({
      status: "onboarded", locked: { cohort: false, dashboard: false },
      resources_available: { store: false, fundraising: false, partners: false, assets: false, support: false },
    });
    render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/isn't open yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/sign your mou/i)).not.toBeInTheDocument();
  });
});
