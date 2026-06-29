import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FileGridAnswer from "../FileGridAnswer.jsx";

// FileGridAnswer no longer imports leadershipApi directly — the signing
// function is injected via the `signedUrl` prop.

let signedUrlMock;

beforeEach(() => {
  signedUrlMock = vi.fn();
});

describe("FileGridAnswer", () => {
  it("renders the empty placeholder when there are no files", () => {
    render(<FileGridAnswer value={[]} applicationId="app-1" signedUrl={signedUrlMock} />);
    expect(screen.queryByRole("button", { name: /Download/i })).toBeNull();
  });

  it("renders a real Download button per file", () => {
    render(
      <FileGridAnswer
        value={[{ name: "patent.pdf", path: "u1/evidence/p.pdf", size: 2048 }]}
        applicationId="app-1"
        signedUrl={signedUrlMock}
      />,
    );
    const btn = screen.getByRole("button", { name: /Download/i });
    expect(btn).not.toBeDisabled();
    expect(screen.getByText("patent.pdf")).toBeInTheDocument();
  });

  it("fetches a signed URL and opens it on click", async () => {
    signedUrlMock.mockResolvedValue({
      url: "https://signed.example/p.pdf?token=x",
      expires_in: 120,
    });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <FileGridAnswer
        value={{ name: "deck.pdf", storage_path: "u1/pitch-deck/d.pdf" }}
        applicationId="app-7"
        signedUrl={signedUrlMock}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Download/i }));

    await waitFor(() =>
      expect(signedUrlMock).toHaveBeenCalledWith(
        "app-7",
        "u1/pitch-deck/d.pdf",
      ),
    );
    expect(openSpy).toHaveBeenCalledWith(
      "https://signed.example/p.pdf?token=x",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("shows an inline error when signing fails", async () => {
    signedUrlMock.mockRejectedValue(new Error("boom"));
    render(
      <FileGridAnswer
        value={[{ name: "x.pdf", path: "u1/evidence/x.pdf" }]}
        applicationId="app-1"
        signedUrl={signedUrlMock}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Download/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  it("disables the button when no application id is available", () => {
    render(
      <FileGridAnswer
        value={[{ name: "x.pdf", path: "u1/evidence/x.pdf" }]}
        signedUrl={signedUrlMock}
      />,
    );
    expect(screen.getByRole("button", { name: /Download/i })).toBeDisabled();
  });

  it("disables the button when no signedUrl fn is provided", () => {
    render(
      <FileGridAnswer
        value={[{ name: "x.pdf", path: "u1/evidence/x.pdf" }]}
        applicationId="app-1"
      />,
    );
    expect(screen.getByRole("button", { name: /Download/i })).toBeDisabled();
  });
});
