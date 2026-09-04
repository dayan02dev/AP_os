// Pure translation between the spec-field registry and a rendered form.
//
// The registry is DATA — admins edit it at runtime — so none of this can be a
// database CHECK constraint. In Phase 2 the identical rules run server-side on
// submit and on publish; the client copy is a convenience, never the authority.
//
// `validateSpecs` requires pre-filtered fields: pass it describeFields()
// output, never the raw registry.

// Note: 0 and false are NOT blank — they are real values a required field can
// legitimately hold. That falls out of the checks below (neither matches
// null/undefined/""/[]), so callers need no special-casing.
const isBlank = (v) =>
  v === null || v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** Live (non-archived) fields for one category, in display order. */
export function describeFields(specFields, categoryId) {
  return (specFields || [])
    .filter((f) => f.category_id === categoryId && !f.archived_at)
    .slice()
    .sort((a, b) => a.sort - b.sort);
}

/** Type-appropriate blanks, so an uncontrolled input never warns. */
export function emptyValues(fields) {
  const out = {};
  for (const f of fields) {
    if (f.data_type === "number") out[f.key] = null;
    else if (f.data_type === "multi_enum") out[f.key] = [];
    else if (f.data_type === "boolean") out[f.key] = false;
    else out[f.key] = "";
  }
  return out;
}

/** DOM value -> stored value. Bad input is passed through for validation. */
export function coerceValue(field, raw) {
  switch (field.data_type) {
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;   // keep junk so validate can report it
    }
    case "multi_enum":
      if (Array.isArray(raw)) return raw;
      return isBlank(raw) ? [] : [raw];
    case "boolean":
      return raw === true || raw === "on" || raw === "true";
    default:
      return raw ?? "";
  }
}

/**
 * Validate values against the LIVE field set.
 * `fields` must already be the output of describeFields — archived fields are
 * excluded there, which is what stops an archived-but-required field from
 * invalidating every existing product.
 */
export function validateSpecs(fields, values) {
  // Enforce the contract rather than trusting it: `fields` must already be
  // describeFields() output. A caller passing the raw registry would silently
  // enforce archived-but-required fields against products that never had them,
  // and would accept keys from other categories.
  const archived = (fields || []).filter((f) => f.archived_at);
  if (archived.length) {
    throw new Error(
      `validateSpecs received archived fields (${archived.map((f) => f.key).join(", ")}) — pass describeFields() output, not the raw registry.`,
    );
  }

  const errors = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));

  for (const key of Object.keys(values || {})) {
    if (!byKey.has(key)) errors[key] = `"${key}" is not a field in this category.`;
  }

  for (const f of fields) {
    const v = values?.[f.key];

    if (f.required && isBlank(v)) {
      errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (isBlank(v)) continue;   // optional and empty

    if (f.data_type === "number" && !Number.isFinite(v)) {
      errors[f.key] = `${f.label} must be a number.`;
    }
    if (f.data_type === "enum" && !(f.enum_options || []).includes(v)) {
      errors[f.key] = `"${v}" is not an allowed value for ${f.label}.`;
    }
    if (f.data_type === "multi_enum") {
      const bad = (v || []).filter((x) => !(f.enum_options || []).includes(x));
      if (bad.length) errors[f.key] = `${bad.join(", ")} not allowed for ${f.label}.`;
    }
    if (f.data_type === "boolean" && typeof v !== "boolean") {
      errors[f.key] = `${f.label} must be true or false.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
