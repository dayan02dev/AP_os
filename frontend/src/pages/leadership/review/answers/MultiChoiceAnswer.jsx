// MultiChoiceAnswer — same visual as ChoiceAnswer but takes an array of
// selected values and highlights every match. Not used by any current
// wizard field, but kept so future multi-select questions can drop in
// without a renderer migration.

import EmptyAnswer from "./EmptyAnswer.jsx";

const ALPHA = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export default function MultiChoiceAnswer({ value, options }) {
  if (!Array.isArray(options) || options.length === 0) return <EmptyAnswer />;
  const selected = Array.isArray(value) ? new Set(value) : new Set();
  if (selected.size === 0) return <EmptyAnswer />;
  return (
    <ul className="ans-choices" role="list">
      {options.map((opt, idx) => {
        const isSel = selected.has(opt);
        return (
          <li
            key={opt}
            className={`ans-choice${isSel ? " is-selected" : ""}`}
          >
            <span className="key">{ALPHA[idx] || ""}</span>
            <span>{opt}</span>
            {isSel && <span className="mark" aria-hidden="true" />}
          </li>
        );
      })}
    </ul>
  );
}
