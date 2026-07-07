// LinkAnswer — renders a URL answer (e.g. LinkedIn) as a clickable link that
// opens in a new tab. Falls through to the shared muted placeholder when blank.

import EmptyAnswer from "./EmptyAnswer.jsx";

function normalizeUrl(u) {
  const s = (u || "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

export default function LinkAnswer({ value }) {
  const href = normalizeUrl(value);
  if (!href) return <EmptyAnswer />;
  return (
    <a className="ans-link" href={href} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  );
}
