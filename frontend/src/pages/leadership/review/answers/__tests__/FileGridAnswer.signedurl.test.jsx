import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FileGridAnswer from "../FileGridAnswer.jsx";

describe("FileGridAnswer signedUrl prop", () => {
  it("calls the injected signedUrl fn on download", async () => {
    const signedUrl = vi.fn().mockResolvedValue({ url: "https://example.test/file.pdf" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <FileGridAnswer
        applicationId="app-1"
        signedUrl={signedUrl}
        value={[{ name: "deck.pdf", storage_path: "app-1/pitch-deck/x.pdf", size: 1234 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Download/i }));
    await waitFor(() => expect(signedUrl).toHaveBeenCalledWith("app-1", "app-1/pitch-deck/x.pdf"));
    openSpy.mockRestore();
  });
});
