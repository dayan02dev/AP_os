// ReadMoreText — long-text with a "Read more" / "Read less" toggle.
//
// Truncates to ~`words` words (default 75) with an inline toggle. Preserves
// newlines via white-space: pre-wrap on the (optionally classed) container.
// Shared by the leadership review TextAnswer + the AppDrawer problem/solution
// fields so every long essay reads the same way.

import { useState } from "react";

const WORD_CAP = 75;

export default function ReadMoreText({ text, className = "", words = WORD_CAP }) {
  const [open, setOpen] = useState(false);
  const str = typeof text === "string" ? text : String(text ?? "");
  const tokens = str.trim().split(/\s+/);
  const isLong = tokens.length > words;
  const shown = !isLong || open ? str : tokens.slice(0, words).join(" ") + "…";

  return (
    <div className={className} style={{ whiteSpace: "pre-wrap", wordWrap: "break-word" }}>
      {shown}
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginLeft: 6,
            padding: 0,
            border: "none",
            background: "none",
            color: "var(--artblue, #3213b7)",
            font: "inherit",
            fontWeight: 600,
            cursor: "pointer",
            textDecoration: "underline",
            whiteSpace: "nowrap",
          }}
        >
          {open ? "Read less" : "Read more"}
        </button>
      )}
    </div>
  );
}
