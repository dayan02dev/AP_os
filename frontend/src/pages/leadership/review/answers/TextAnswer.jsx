// TextAnswer — short / long / email / generic textual answer.
//
// Falls through to EmptyAnswer if the value is null/undefined or an
// all-whitespace string. Preserves newlines via white-space: pre-wrap
// (from .ans-inset).
//
// Deliberately renders the answer IN FULL — no "Read more" clamp. Export PDF
// is window.print() over this same DOM, so any text hidden behind a toggle is
// text missing from the exported PDF (it printed the truncated essay plus a
// literal "Read more" link). Reviewers download these to read the whole
// answer, so the full essay must always be in the document.

import EmptyAnswer from "./EmptyAnswer.jsx";

export default function TextAnswer({ value }) {
  if (value === null || value === undefined) return <EmptyAnswer />;
  const text = typeof value === "string" ? value : String(value);
  if (!text.trim()) return <EmptyAnswer />;
  return <div className="ans-inset">{text}</div>;
}
