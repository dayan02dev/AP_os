import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResumeUploadCard from "../ResumeUploadCard.jsx";

function pdfFile(name = "cv.pdf", sizeBytes = 1024) {
  const f = new File(["x".repeat(sizeBytes)], name, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: sizeBytes });
  return f;
}

describe("ResumeUploadCard", () => {
  it("shows the upload prompt when no resume is uploaded", () => {
    render(<ResumeUploadCard onUpload={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Drop a PDF or click to choose/i)).toBeInTheDocument();
  });

  it("shows the uploaded card with filename + size + Replace + Remove", () => {
    render(<ResumeUploadCard
      resumeFileId="00000000-0000-0000-0000-000000000001"
      resumeFilename="alice.pdf"
      resumeSize={245678}
      onUpload={vi.fn()}
      onRemove={vi.fn()}
    />);
    expect(screen.getByText("alice.pdf")).toBeInTheDocument();
    expect(screen.getByText(/240\s*KB|245\.7\s*KB/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("rejects non-PDF files with a toast/error", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [txt] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/PDF only/i)).toBeInTheDocument();
  });

  it("rejects files larger than 5MB", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const big = pdfFile("big.pdf", 6 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [big] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/5\s*MB/i)).toBeInTheDocument();
  });

  it("calls onUpload with the picked PDF", () => {
    const onUpload = vi.fn();
    render(<ResumeUploadCard onUpload={onUpload} onRemove={vi.fn()} />);
    const input = screen.getByLabelText(/upload resume/i, { selector: "input" });
    const pdf = pdfFile("ok.pdf", 1024);
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0].name).toBe("ok.pdf");
  });

  it("Remove triggers onRemove", () => {
    const onRemove = vi.fn();
    render(<ResumeUploadCard
      resumeFileId="00000000-0000-0000-0000-000000000001"
      resumeFilename="alice.pdf"
      resumeSize={1024}
      onUpload={vi.fn()}
      onRemove={onRemove}
    />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
