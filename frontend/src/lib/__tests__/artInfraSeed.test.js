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

  it("actually maps the seeded free-text specs onto registry keys", () => {
    const mapped = seed.products.reduce((a, p) => a + Object.keys(p.specs).length, 0);
    const extra = seed.products.reduce((a, p) => a + p.extra_specs.length, 0);
    // Would have caught the original 9-of-42 mapping: most specs must land on
    // a real field, not in the free-text remainder.
    expect(mapped).toBeGreaterThan(extra);
    // Every seeded product has specs in the source catalog, so every one must
    // map at least one field. No guard: `{}` is truthy, so the obvious
    // `if (p.specs)` filters nothing and just hides the assertion's real scope.
    for (const p of seed.products) {
      expect(Object.keys(p.specs).length).toBeGreaterThan(0);
    }
  });

  it("marks no seeded field required, so legacy products stay editable", () => {
    for (const f of seed.spec_fields) expect(f.required).toBe(false);
  });

  it("every seeded spec value satisfies its field's declared type", () => {
    const byKey = new Map(
      seed.spec_fields.map((f) => [`${f.category_id}/${f.key}`, f]));
    const bad = [];
    for (const p of seed.products) {
      for (const [k, v] of Object.entries(p.specs || {})) {
        const f = byKey.get(`${p.category_id}/${k}`);
        if (!f) continue;
        if (f.data_type === "number" && !Number.isFinite(Number(v))) bad.push(`${p.id}.${k}=${v}`);
        if (f.data_type === "enum" && !(f.enum_options || []).includes(v)) bad.push(`${p.id}.${k}=${v}`);
        if (f.data_type === "multi_enum" && !Array.isArray(v)) bad.push(`${p.id}.${k}=${v}`);
        if (f.data_type === "boolean" && typeof v !== "boolean") bad.push(`${p.id}.${k}=${v}`);
      }
    }
    // A mismatch here means the editor will blank a real value on load and
    // discard it on save. Retype the field to match the data, never the reverse.
    expect(bad).toEqual([]);
  });
});
