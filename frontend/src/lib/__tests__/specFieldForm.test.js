import { describe, it, expect } from "vitest";
import {
  describeFields, emptyValues, coerceValue, validateSpecs,
} from "../specFieldForm.js";

const FIELDS = [
  { category_id: "sensors", key: "modality", label: "Sensing modality",
    data_type: "text", required: true, sort: 0, archived_at: null },
  { category_id: "sensors", key: "channels", label: "Channels",
    data_type: "number", unit: null, required: false, sort: 1, archived_at: null },
  { category_id: "sensors", key: "interface", label: "Interface",
    data_type: "multi_enum", enum_options: ["I2C", "SPI", "PDM"],
    required: false, sort: 2, archived_at: null },
  { category_id: "sensors", key: "grade", label: "Grade", data_type: "enum",
    enum_options: ["A", "B"], required: false, sort: 3, archived_at: null },
  { category_id: "sensors", key: "rohs", label: "RoHS", data_type: "boolean",
    required: false, sort: 4, archived_at: null },
  { category_id: "sensors", key: "legacy", label: "Legacy", data_type: "text",
    required: true, sort: 5, archived_at: "2026-09-01T00:00:00Z" },
  { category_id: "fabrication", key: "process", label: "Process",
    data_type: "enum", enum_options: ["CNC milling"], required: true, sort: 0,
    archived_at: null },
];

describe("describeFields", () => {
  it("returns only this category's fields, in sort order", () => {
    const out = describeFields(FIELDS, "sensors");
    expect(out.map((f) => f.key)).toEqual(
      ["modality", "channels", "interface", "grade", "rohs"]);
  });

  it("excludes archived fields", () => {
    expect(describeFields(FIELDS, "sensors").some((f) => f.key === "legacy")).toBe(false);
  });

  it("returns a different field set for a different category", () => {
    expect(describeFields(FIELDS, "fabrication").map((f) => f.key)).toEqual(["process"]);
  });

  it("returns empty for an unknown category rather than throwing", () => {
    expect(describeFields(FIELDS, "nope")).toEqual([]);
  });
});

describe("coerceValue", () => {
  const f = (data_type) => ({ key: "x", data_type, enum_options: ["A", "B"] });

  it("turns a numeric string into a number", () => {
    expect(coerceValue(f("number"), "42")).toBe(42);
  });

  it("turns an empty string into null, not 0", () => {
    expect(coerceValue(f("number"), "")).toBeNull();
  });

  it("leaves a non-numeric string alone so validation can report it", () => {
    expect(coerceValue(f("number"), "eight")).toBe("eight");
  });

  it("always yields an array for multi_enum", () => {
    expect(coerceValue(f("multi_enum"), "A")).toEqual(["A"]);
    expect(coerceValue(f("multi_enum"), ["A", "B"])).toEqual(["A", "B"]);
    expect(coerceValue(f("multi_enum"), "")).toEqual([]);
  });

  it("coerces boolean from checkbox values", () => {
    expect(coerceValue(f("boolean"), true)).toBe(true);
    expect(coerceValue(f("boolean"), "on")).toBe(true);
    expect(coerceValue(f("boolean"), false)).toBe(false);
  });
});

describe("validateSpecs", () => {
  const live = describeFields(FIELDS, "sensors");

  it("passes when required fields are filled", () => {
    expect(validateSpecs(live, { modality: "Acoustic" })).toEqual({ ok: true, errors: {} });
  });

  it("fails a missing required field", () => {
    const r = validateSpecs(live, {});
    expect(r.ok).toBe(false);
    expect(r.errors.modality).toMatch(/required/i);
  });

  it("treats whitespace as missing", () => {
    expect(validateSpecs(live, { modality: "   " }).ok).toBe(false);
  });

  it("rejects a non-numeric value in a number field", () => {
    const r = validateSpecs(live, { modality: "Acoustic", channels: "eight" });
    expect(r.ok).toBe(false);
    expect(r.errors.channels).toMatch(/number/i);
  });

  it("accepts zero as a real number, not as missing", () => {
    expect(validateSpecs(live, { modality: "Acoustic", channels: 0 }).ok).toBe(true);
  });

  it("rejects an enum value outside its options", () => {
    const r = validateSpecs(live, { modality: "Acoustic", grade: "Z" });
    expect(r.errors.grade).toMatch(/not an allowed/i);
  });

  it("rejects a multi_enum containing an unknown option", () => {
    const r = validateSpecs(live, { modality: "Acoustic", interface: ["I2C", "CAN"] });
    expect(r.errors.interface).toMatch(/CAN/);
  });

  it("rejects a key that is not a live field for this category", () => {
    const r = validateSpecs(live, { modality: "Acoustic", process: "CNC milling" });
    expect(r.ok).toBe(false);
    expect(r.errors.process).toMatch(/not a field/i);
  });

  it("does NOT require a field that has been archived", () => {
    // `legacy` is required but archived — an admin archiving a field must not
    // retroactively invalidate every product that never had it.
    expect(validateSpecs(live, { modality: "Acoustic" }).ok).toBe(true);
  });
});

describe("emptyValues", () => {
  it("seeds blanks appropriate to each type", () => {
    expect(emptyValues(describeFields(FIELDS, "sensors"))).toEqual({
      modality: "", channels: null, interface: [], grade: "", rohs: false,
    });
  });
});
