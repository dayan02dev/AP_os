import { describe, it, expect } from "vitest";
import { LABEL_TO_TOKEN, TOKEN_TO_LABEL, DOMAIN_TOKENS } from "../artparkDomains";

describe("artparkDomains", () => {
  it("maps the 13 real industry labels to tokens", () => {
    expect(LABEL_TO_TOKEN["Artificial Intelligence / Foundational Models"]).toBe("ai");
    expect(LABEL_TO_TOKEN["Healthcare / MedTech"]).toBe("health");
    expect(LABEL_TO_TOKEN["Communication (Wired & Wireless)"]).toBe("comms");
    expect(LABEL_TO_TOKEN["Climate Fintech / Urban Resilience"]).toBe("climate_fintech");
    expect(Object.keys(LABEL_TO_TOKEN)).toHaveLength(13);
  });
  it("TOKEN_TO_LABEL is the inverse", () => {
    expect(TOKEN_TO_LABEL.ai).toBe("Artificial Intelligence / Foundational Models");
    expect(TOKEN_TO_LABEL.comms).toBe("Communication (Wired & Wireless)");
    for (const [label, tok] of Object.entries(LABEL_TO_TOKEN))
      expect(TOKEN_TO_LABEL[tok]).toBe(label);
  });
  it("DOMAIN_TOKENS lists all 13 tokens", () => {
    expect(DOMAIN_TOKENS).toHaveLength(13);
    expect(DOMAIN_TOKENS).toContain("ev_mobility_services");
  });
});
