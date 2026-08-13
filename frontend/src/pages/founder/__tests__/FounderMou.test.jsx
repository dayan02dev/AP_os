import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FounderMou from "../FounderMou.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const ACKS = [
  { id: "full_time_presence", text: "I acknowledge that ARTPARK Technology in Residence is a full time program…" },
  { id: "first_right_of_refusal", text: "I acknowledge that ARTPARK Residency program provides ARTPARK the first right of refusal…" },
  { id: "expense_account_procurement", text: "I acknowledge that ARTPARK Residency program is an expense account…" },
  { id: "additional_funding_equity", text: "I acknowledge that post the initial 25L…" },
];

const unsigned = (over = {}) => ({
  template_version: "tir-mou-v2", body: "MOU text", signed: false, signer_name: "",
  acknowledgements: ACKS, accepted_acknowledgements: [], ...over,
});

describe("FounderMou", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the signed confirmation + download when already signed", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue({
      template_version: "tir-mou-v2", body: "MOU text", signed: true,
      signer_name: "Priya", signed_at: "2026-07-17T00:00:00Z",
      acknowledgements: ACKS, accepted_acknowledgements: ACKS.map((a) => a.id),
    });
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/MOU signed/i)).toBeInTheDocument());
    expect(screen.getByText(/Download signed MOU/i)).toBeInTheDocument();
  });

  it("renders the signature pad + Sign button when unsigned", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/Sign & submit/i)).toBeInTheDocument());
  });

  it("renders one checkbox per server-supplied acknowledgement", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/Sign & submit/i)).toBeInTheDocument());
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByText(/full time program/i)).toBeInTheDocument();
    expect(screen.getByText(/first right of refusal/i)).toBeInTheDocument();
    expect(screen.getByText(/expense account/i)).toBeInTheDocument();
    expect(screen.getByText(/post the initial 25L/i)).toBeInTheDocument();
  });

  it("keeps Sign disabled until every acknowledgement is ticked", async () => {
    const user = userEvent.setup();
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/Sign & submit/i)).toBeInTheDocument());

    const signBtn = screen.getByRole("button", { name: /Sign & submit/i });
    const boxes = screen.getAllByRole("checkbox");
    expect(signBtn).toBeDisabled();

    // tick three of four — still blocked, and the hint is still shown
    for (const b of boxes.slice(0, 3)) await user.click(b);
    expect(signBtn).toBeDisabled();
    expect(screen.getByText(/must be confirmed before you can sign/i)).toBeInTheDocument();

    // the fourth clears the acknowledgement gate (name + signature still
    // required, which is asserted separately)
    await user.click(boxes[3]);
    expect(screen.queryByText(/must be confirmed before you can sign/i)).not.toBeInTheDocument();
  });

  it("unticking an acknowledgement re-blocks signing", async () => {
    const user = userEvent.setup();
    vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/Sign & submit/i)).toBeInTheDocument());

    const boxes = screen.getAllByRole("checkbox");
    for (const b of boxes) await user.click(b);
    expect(screen.queryByText(/must be confirmed before you can sign/i)).not.toBeInTheDocument();

    await user.click(boxes[1]);
    expect(screen.getByText(/must be confirmed before you can sign/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign & submit/i })).toBeDisabled();
  });
});
