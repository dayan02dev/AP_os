// TextAnswer — short / long / email / generic textual answer.
//
// Falls through to EmptyAnswer if the value is null/undefined or an
// all-whitespace string. Preserves newlines via white-space: pre-wrap.

import EmptyAnswer from "./EmptyAnswer.jsx";
import ReadMoreText from "../../components/ReadMoreText.jsx";

export default function TextAnswer({ value }) {
  if (value === null || value === undefined) return <EmptyAnswer />;
  const text = typeof value === "string" ? value : String(value);
  if (!text.trim()) return <EmptyAnswer />;
  return <ReadMoreText text={text} className="ans-inset" />;
}
