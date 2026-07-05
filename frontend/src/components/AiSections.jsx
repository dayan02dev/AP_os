import { useState } from "react";
import "../styles/ai-sections.css";

const SECTION_DEFS = [
  ["problem", "Problem Description"],
  ["solution", "Solution Description"],
  ["moats", "Moats & Technology Edge"],
  ["watchouts", "Watch-outs or Flags"],
  ["founder", "Founder Check"],
];

function normalize(sections) {
  const out = [];
  for (const [key, label] of SECTION_DEFS) {
    const bullets = Array.isArray(sections?.[key])
      ? sections[key].filter((b) => typeof b === "string" && b.trim())
      : [];
    if (bullets.length) out.push({ key, label, bullets });
  }
  return out;
}

export default function AiSections({ sections, variant = "dropdown" }) {
  const items = normalize(sections);
  const [open, setOpen] = useState({});

  if (!items.length) {
    return <div className="ai-sec-empty">AI sections not generated yet.</div>;
  }

  if (variant === "leadership") {
    return (
      <div className="ai-sec-lead">
        {items.map((it) => (
          <div className="ai-sec-lead-block" key={it.key}>
            <div className="ai-sec-lead-label">{it.label}</div>
            <ul className="ai-sec-bullets">
              {it.bullets.map((b, i) => (<li key={i}>{b}</li>))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ai-sec-list">
      {items.map((it, i) => {
        const isOpen = it.key in open ? open[it.key] : i === 0;
        return (
          <div className={"ai-sec" + (isOpen ? " is-open" : "")} key={it.key}>
            <button
              className="ai-sec-head"
              aria-expanded={isOpen}
              onClick={() => setOpen((p) => ({ ...p, [it.key]: !isOpen }))}
            >
              <span className="ai-sec-chev">{isOpen ? "▾" : "▸"}</span>
              <span className="ai-sec-label">{it.label}</span>
              <span className="ai-sec-hint">{isOpen ? "" : it.bullets.length + " points"}</span>
            </button>
            {isOpen && (
              <ul className="ai-sec-bullets">
                {it.bullets.map((b, j) => (<li key={j}>{b}</li>))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
