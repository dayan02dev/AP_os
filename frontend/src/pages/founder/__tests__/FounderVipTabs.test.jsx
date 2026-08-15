import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FounderPortal from "../FounderPortal.jsx";
import { founderApi } from "../../../lib/founderApi.js";
import { api } from "../../../lib/api.js";

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

  it("hides Push to procurement for a VIP founder but keeps it for TIR", async () => {
    vi.spyOn(founderApi, "getStore").mockResolvedValue({
      catalog: [], cart: [{ product_id: "p1", name: "Thing", qty: 1, unit_price: 100, line_total: 100 }],
      cart_subtotal: 100,
    });

    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "sip" });
    const vip = render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cart/ }));
    expect(screen.queryByText(/Push to procurement/i)).not.toBeInTheDocument();
    vip.unmount();

    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "tir" });
    render(<MemoryRouter><FounderPortal tab="store" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/procurement store/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Cart/ }));
    await waitFor(() => expect(screen.getByText(/Push to procurement/i)).toBeInTheDocument());
  });

  it("fetches the VIP application from the sip endpoint, not the TIR one", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue([{ id: "a1" }]);
    vi.spyOn(founderApi, "me").mockResolvedValue({ ...me(false), track: "sip" });
    render(<MemoryRouter><FounderPortal tab="application" /></MemoryRouter>);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/sip-applications/me/submitted"));
    expect(get).not.toHaveBeenCalledWith("/applications/me/submitted");
  });
});
