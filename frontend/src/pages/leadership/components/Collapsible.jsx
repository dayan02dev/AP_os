// Collapsible — a single accordion section: a clickable header (label +
// chevron, optional right-aligned hint) and a body that shows/hides.
//
// Used to tame the dense leadership surfaces (AI summary detail sections,
// the row drawer's long free-text answers) by hiding secondary content
// behind a tap while keeping the main pointers visible. Content is always
// in the DOM-on-open (not virtualized) so it prints/exports fine.

import { useState } from "react";

export default function Collapsible({
  label,
  hint,
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`lp-collapse${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="lp-collapse-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="lp-collapse-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="lp-collapse-label">{label}</span>
        {hint != null && <span className="lp-collapse-hint">{hint}</span>}
      </button>
      {open && <div className="lp-collapse-body">{children}</div>}
    </div>
  );
}
