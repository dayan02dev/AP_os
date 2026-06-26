import { describe, it, expect, vi, beforeEach } from "vitest";
import { printWithTitle } from "../printDocument.js";

beforeEach(() => {
  document.title = "original";
});

describe("printWithTitle", () => {
  it("sets the title, calls window.print, and restores on afterprint", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    printWithTitle("SIP-2026-aae677aa — Brain Morph Technologies");

    expect(document.title).toBe("SIP-2026-aae677aa — Brain Morph Technologies");
    expect(printSpy).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("original");

    printSpy.mockRestore();
  });

  it("keeps the original title when given an empty title but still prints", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});

    printWithTitle("");

    expect(document.title).toBe("original");
    expect(printSpy).toHaveBeenCalledTimes(1);

    printSpy.mockRestore();
  });
});
