// ChoiceAnswer — single-select. Renders all options and highlights the
// selected one with the mint/teal accent (--artlight bg). If no value, we
// still render the options dim so reviewer sees what *could* have been
// picked; the option marker shifts to "—".

import EmptyAnswer from "./EmptyAnswer.jsx";

const ALPHA = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export default function ChoiceAnswer({ value, options }) {
  if (!Array.isArray(options) || options.length === 0) {
    // Schema didn't list options — fall back to a plain inset of the value.
    if (value === null || value === undefined || value === "") return <EmptyAnswer />;
    return <div className="ans-inset">{String(value)}</div>;
  }
  if (value === null || value === undefined || value === "") {
    return <EmptyAnswer />;
  }
  return (
    <ul className="ans-choices" role="list">
      {options.map((opt, idx) => {
        const isSel = opt === value;
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
