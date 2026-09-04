import { describe, it, expect } from "vitest";
import seed from "../__fixtures__/artInfraSeed.json";

describe("artInfraSeed fixture", () => {
  it("carries the real catalog and a spec-field registry", () => {
    expect(seed.vendors).toHaveLength(11);
    expect(seed.categories).toHaveLength(8);
    expect(seed.products).toHaveLength(12);
    expect(seed.spec_fields.length).toBeGreaterThan(40);
  });

  it("defines fields for every category, keyed to that category", () => {
    const withFields = new Set(seed.spec_fields.map((f) => f.category_id));
    for (const c of seed.categories) expect(withFields.has(c.id)).toBe(true);
  });

  it("uses only the five supported data types", () => {
    const allowed = new Set(["text", "number", "enum", "multi_enum", "boolean"]);
    for (const f of seed.spec_fields) expect(allowed.has(f.data_type)).toBe(true);
  });

  it("gives every enum and multi_enum field its options", () => {
    for (const f of seed.spec_fields) {
      if (f.data_type === "enum" || f.data_type === "multi_enum") {
        expect(Array.isArray(f.enum_options)).toBe(true);
        expect(f.enum_options.length).toBeGreaterThan(1);
      }
    }
  });

  it("stores product specs as an object keyed by defined field keys", () => {
    for (const p of seed.products) {
      expect(Array.isArray(p.specs)).toBe(false);
      const keys = new Set(
        seed.spec_fields.filter((f) => f.category_id === p.category_id).map((f) => f.key),
      );
      for (const k of Object.keys(p.specs)) expect(keys.has(k)).toBe(true);
    }
  });
});
