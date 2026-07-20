import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderFundraising from "../FounderFundraising.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const investor = {
  id: "i1", name: "Anish Rao", firm: "Endiya Partners",
  focus: "Seed · deep-tech health", cheque: "₹4–8 Cr", thesis: "Medtech",
  intro_requested: false,
};
const tools = [{ name: "Pitch deck template", desc: "ARTPARK's deep-tech narrative structure." }];

describe("FounderFundraising", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders matched investors + toolkit and flips the intro button label after toggling", async () => {
    vi.spyOn(founderApi, "getFundraising")
      .mockResolvedValueOnce({ investors: [investor], tools })
      .mockResolvedValueOnce({ investors: [{ ...investor, intro_requested: true }], tools });
    vi.spyOn(founderApi, "toggleIntro").mockResolvedValue({ intro_requested: true });

    render(<FounderFundraising />);

    await waitFor(() => expect(screen.getByText("Anish Rao")).toBeInTheDocument());
    expect(screen.getByText("Pitch deck template")).toBeInTheDocument();
    expect(screen.getByText("Suggested match")).toBeInTheDocument();
    expect(screen.getByText("Request intro")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Request intro"));
    await waitFor(() => expect(founderApi.toggleIntro).toHaveBeenCalledWith("i1"));
    await waitFor(() => expect(screen.getByText("Cancel request")).toBeInTheDocument());
    expect(screen.getByText("Intro requested")).toBeInTheDocument();
  });
});
