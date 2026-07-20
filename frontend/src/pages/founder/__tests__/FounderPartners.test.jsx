import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderPartners from "../FounderPartners.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const partner = {
  id: "pt1", name: "Narayana Health", sector: "Hospital network",
  offer: "Clinical pilots and validation sites across neonatal and cardiac units.",
  requested: false,
};

describe("FounderPartners", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("flips the connection button label after toggling", async () => {
    vi.spyOn(founderApi, "getPartners")
      .mockResolvedValueOnce({ partners: [partner] })
      .mockResolvedValueOnce({ partners: [{ ...partner, requested: true }] });
    vi.spyOn(founderApi, "togglePartner").mockResolvedValue({ requested: true });

    render(<FounderPartners />);

    await waitFor(() => expect(screen.getByText("Narayana Health")).toBeInTheDocument());
    expect(screen.getByText("Request connection")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Request connection"));
    await waitFor(() => expect(founderApi.togglePartner).toHaveBeenCalledWith("pt1"));
    await waitFor(() => expect(screen.getByText("Request sent ✓")).toBeInTheDocument());
  });
});
