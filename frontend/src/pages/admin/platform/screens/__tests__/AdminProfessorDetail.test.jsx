// splitList is what turns the scrape's cramped semicolon-joined strings into
// real lists, and it has to survive the citation clusters that appear inside
// `notable_work` — those contain their own semicolons.

import { describe, it, expect } from "vitest";
import { splitList, tokensOf } from "../AdminProfessorDetail";

describe("splitList", () => {
  it("splits a plain semicolon-joined field", () => {
    expect(splitList("approximation algorithms; fair division; computational economics"))
      .toEqual(["approximation algorithms", "fair division", "computational economics"]);
  });

  it("does NOT split inside a bracketed citation cluster", () => {
    // Real row (Payel Roy): the parenthesised journals must stay with their item.
    const raw = "Identified apolipoprotein-B-reactive T-cell motifs and MHC-II epitopes "
      + "in atherosclerosis (Nat Rev Immunol 2022; Circ Res 2022); characterized human "
      + "exTregs as CD16+CD56+ cytotoxic CD4+ T cells (Nat Immunol 2023); builds "
      + "integrated high-throughput + computational models";
    const out = splitList(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("(Nat Rev Immunol 2022; Circ Res 2022)");
    expect(out[1]).toContain("(Nat Immunol 2023)");
    expect(out[2]).toBe("builds integrated high-throughput + computational models");
  });

  it("handles square brackets too", () => {
    expect(splitList("a [x; y]; b")).toEqual(["a [x; y]", "b"]);
  });

  it("drops empty segments, stray whitespace and em-dash placeholders", () => {
    expect(splitList("  a ;; ; b ; — ")).toEqual(["a", "b"]);
  });

  it("tolerates unbalanced brackets without losing the tail", () => {
    expect(splitList("a (x; b")).toEqual(["a (x; b"]);
    expect(splitList("a); b")).toEqual(["a)", "b"]);
  });

  it("returns [] for empty, null and undefined", () => {
    expect(splitList("")).toEqual([]);
    expect(splitList(null)).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
  });

  it("keeps a single item with no separator intact", () => {
    expect(splitList("just one thing")).toEqual(["just one thing"]);
  });
});

describe("tokensOf", () => {
  it("parses ARTPARK domain tokens", () => {
    expect(tokensOf("health; ai")).toEqual(["health", "ai"]);
  });

  it("treats an em dash and blanks as no domains", () => {
    expect(tokensOf("—")).toEqual([]);
    expect(tokensOf("")).toEqual([]);
    expect(tokensOf(null)).toEqual([]);
  });
});
