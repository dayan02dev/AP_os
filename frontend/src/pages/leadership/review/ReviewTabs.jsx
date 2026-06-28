// ReviewTabs — Application / Reviews / History tab strip.
//
// Phase 1 ships three tabs. (Earlier designs also showed Assessment, Evidence
// & Files, and Discussion — out of scope and no longer rendered.)

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
  return (
    <nav className="review-tabs" aria-label="Application sections">
      <Btn id="application" label="Application" />
      <Btn id="reviews" label="Reviews" />
      <Btn id="history" label="History" />
    </nav>
  );
}
