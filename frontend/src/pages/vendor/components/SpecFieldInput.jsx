// Renders exactly one registry-defined field. All type branching lives here so
// the editor stays a layout component: it hands each field to this component
// and never has to know what a "multi_enum" is.

export default function SpecFieldInput({ field, value, onChange, error }) {
  const label = field.label + (field.required ? " *" : "");

  if (field.data_type === "boolean") {
    return (
      <label>
        <input
          type="checkbox"
          aria-label={field.label}
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {" "}{label}
        {field.help_text && <span className="vp-help">{field.help_text}</span>}
        {error && <span className="vp-field-err">{error}</span>}
      </label>
    );
  }

  if (field.data_type === "enum") {
    return (
      <label>
        {label}
        <select
          className="os-input"
          aria-label={field.label}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Select…</option>
          {(field.enum_options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        {field.help_text && <span className="vp-help">{field.help_text}</span>}
        {error && <span className="vp-field-err">{error}</span>}
      </label>
    );
  }

  if (field.data_type === "multi_enum") {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (opt) =>
      onChange(selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]);
    return (
      <div>
        <div className="section-lbl">{label}</div>
        <div className="vp-multi">
          {(field.enum_options || []).map((o) => (
            <label key={o}>
              <input
                type="checkbox"
                aria-label={o}
                checked={selected.includes(o)}
                onChange={() => toggle(o)}
              />
              {o}
            </label>
          ))}
        </div>
        {field.help_text && <span className="vp-help">{field.help_text}</span>}
        {error && <span className="vp-field-err">{error}</span>}
      </div>
    );
  }

  // text and number
  return (
    <label>
      {label}
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="os-input"
          aria-label={field.label}
          type={field.data_type === "number" ? "number" : "text"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && <span className="vp-help">{field.unit}</span>}
      </span>
      {field.help_text && <span className="vp-help">{field.help_text}</span>}
      {error && <span className="vp-field-err">{error}</span>}
    </label>
  );
}
