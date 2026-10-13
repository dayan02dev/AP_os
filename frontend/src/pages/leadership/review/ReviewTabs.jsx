// ReviewTabs — Application / Reviews / History tab strip.
//
// Phase 1 ships three tabs. (Earlier designs also showed Assessment, Evidence
// & Files, and Discussion — out of scope and no longer rendered.) The VIP memo
// pilot apps pass their own `tabs` (AI Memo / Application / Reviews), and the
// admin detail page reuses the strip with its own `className`.

export const DEFAULT_TABS = [
  { id: "application", label: "Application" },
  { id: "reviews", label: "Reviews" },
  { id: "history", label: "History" },
];

export const VIP_MEMO_TABS = [
  { id: "memo", label: "AI Memo" },
  { id: "application", label: "Application" },
  { id: "reviews", label: "Reviews" },
];

export default function ReviewTabs({ tab, onChange, tabs = DEFAULT_TABS, className = "review-tabs" }) {
  return (
    <nav className={className} aria-label="Application sections">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={tab === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
