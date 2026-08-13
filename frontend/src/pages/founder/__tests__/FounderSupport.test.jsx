import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import FounderSupport from "../FounderSupport.jsx";
import { founderApi } from "../../../lib/founderApi.js";

describe("FounderSupport", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders existing tickets and submits a new one", async () => {
    vi.spyOn(founderApi, "getSupport")
      .mockResolvedValueOnce({
        tickets: [{ id: "t0", ref: "IT-104", area: "IT", priority: "High", subject: "GPU workstation access", status: "in-progress" }],
      })
      .mockResolvedValueOnce({
        tickets: [
          { id: "t1", ref: "IT-105", area: "IT", priority: "Medium", subject: "VPN certificate issue", status: "open" },
          { id: "t0", ref: "IT-104", area: "IT", priority: "High", subject: "GPU workstation access", status: "in-progress" },
        ],
      });
    vi.spyOn(founderApi, "createTicket").mockResolvedValue({});

    render(<FounderSupport />);

    await waitFor(() => expect(screen.getByText("GPU workstation access")).toBeInTheDocument());
    expect(screen.getByText("IT-104")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "VPN certificate issue" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit ticket" }));

    await waitFor(() =>
      expect(founderApi.createTicket).toHaveBeenCalledWith({
        area: "IT", priority: "Medium", subject: "VPN certificate issue", description: "",
      })
    );
    await waitFor(() => expect(screen.getByText("VPN certificate issue")).toBeInTheDocument());
    expect(screen.getByText("IT-105")).toBeInTheDocument();
  });

  it("keeps the submit button disabled without a subject", async () => {
    vi.spyOn(founderApi, "getSupport").mockResolvedValue({ tickets: [] });
    render(<FounderSupport />);

    await waitFor(() => expect(screen.getByText("Your tickets")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Submit ticket" })).toBeDisabled();
  });
});
