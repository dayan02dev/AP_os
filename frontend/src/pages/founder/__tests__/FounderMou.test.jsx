import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FounderMou from "../FounderMou.jsx";
import { founderApi } from "../../../lib/founderApi.js";

describe("FounderMou", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders the signed confirmation + download when already signed", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue({
      template_version: "tir-mou-v1", body: "MOU text", signed: true,
      signer_name: "Priya", signed_at: "2026-07-17T00:00:00Z",
    });
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/MOU signed/i)).toBeInTheDocument());
    expect(screen.getByText(/Download signed MOU/i)).toBeInTheDocument();
  });

  it("renders the signature pad + Sign button when unsigned", async () => {
    vi.spyOn(founderApi, "getMou").mockResolvedValue({
      template_version: "tir-mou-v1", body: "MOU text", signed: false, signer_name: "",
    });
    render(<FounderMou me={{}} />);
    await waitFor(() => expect(screen.getByText(/Sign & submit/i)).toBeInTheDocument());
  });
});
