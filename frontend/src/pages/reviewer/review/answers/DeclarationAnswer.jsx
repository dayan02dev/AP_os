// DeclarationAnswer — read-only checkbox list backed by 4 booleans on the
// application row (declaration_truthful / declaration_ref_checks /
// declaration_terms / declaration_newsletter).
//
// Receives `items` from the schema and the full `application` row so we can
// resolve each item's source column.

export default function DeclarationAnswer({ application, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <ul className="ans-decl" role="list">
      {items.map((it) => {
        const checked = !!application?.[it.key];
        return (
          <li key={it.key} className="ans-decl-item">
            <span
              className={`ans-decl-box${checked ? " checked" : ""}`}
              aria-label={checked ? "Confirmed" : "Not confirmed"}
            >
              {checked ? "✓" : ""}
            </span>
            <span>{it.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
