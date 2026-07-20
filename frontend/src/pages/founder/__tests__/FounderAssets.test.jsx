import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderAssets from "../FounderAssets.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const assets = [
  { id: "a1", name: "NICU test bench (Class II)", loc: "IISc CDS · Block A", avail: "available" },
  { id: "a2", name: "Anechoic acoustic chamber", loc: "IISc EE · Block C", avail: "limited" },
];

describe("FounderAssets", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the asset list + existing bookings", async () => {
    vi.spyOn(founderApi, "getAssets").mockResolvedValue({
      assets,
      bookings: [{ id: "bk1", asset_id: "a1", asset_name: assets[0].name, date: "2026-07-18", slot: "Morning (9–1)", status: "confirmed" }],
    });
    render(<FounderAssets />);

    // Asset names also appear as <option> text in the booking-form select, so
    // scope on the row-only location text to keep these queries unambiguous.
    await waitFor(() => expect(screen.getByText("IISc CDS · Block A")).toBeInTheDocument());
    expect(screen.getByText("IISc EE · Block C")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("Limited")).toBeInTheDocument();
    expect(screen.getByText("2026-07-18 · Morning (9–1)")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("prefills the form from Book, then submits the booking form", async () => {
    vi.spyOn(founderApi, "getAssets")
      .mockResolvedValueOnce({ assets, bookings: [] })
      .mockResolvedValueOnce({
        assets,
        bookings: [{ id: "bk1", asset_id: "a1", asset_name: assets[0].name, date: "2026-07-20", slot: "Morning (9–1)", status: "pending" }],
      });
    vi.spyOn(founderApi, "createBooking").mockResolvedValue({});
    render(<FounderAssets />);

    await waitFor(() => expect(screen.getByText("IISc CDS · Block A")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Book")[0]);
    expect(screen.getByLabelText("Asset").value).toBe("a1");

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }));

    await waitFor(() =>
      expect(founderApi.createBooking).toHaveBeenCalledWith("a1", "2026-07-20", "Morning (9–1)")
    );
    await waitFor(() => expect(screen.getByText("2026-07-20 · Morning (9–1)")).toBeInTheDocument());
  });
});
