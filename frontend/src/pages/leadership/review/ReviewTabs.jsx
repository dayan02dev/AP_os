// ReviewTabs — Application / Reviews / History tab strip.
//
// Phase 1 ships three. The screenshots also showed Assessment, Evidence &
// Files, Discussion — those are explicitly out of scope (Phase 2). We render
// them as disabled placeholders with a tooltip so the design space stays
// visible without breaking.

export default function ReviewTabs({ tab, onChange }) {
  const Btn = ({ id, label, dot }) => (
    <button
      type="button"
      className={tab === id ? "active" : ""}
      onClick={() => onChange(id)}
    >
      {label}
      {dot && <span className="ph-dot" aria-hidden="true" />}
    </button>
  );
  const Disabled = ({ label, title }) => (
    <button
      type="button"
      aria-disabled="true"
      title={title}
      onClick={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
  return (
    <nav className="review-tabs" aria-label="Application sections">
      <Btn id="application" label="Application" />
      <Btn id="reviews" label="Reviews" />
      <Disabled
        label="Discussion"
        title="Internal discussion thread ships in Phase 2."
      />
      <Btn id="history" label="History" />
    </nav>
  );
}
