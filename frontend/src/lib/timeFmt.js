/**
 * Time-formatting helpers for the leadership Applications table.
 *
 * fmtRelative renders the "Submitted" column. Anything within 30 days uses
 * a coarse relative bucket; older rows fall back to "DD MMM YYYY" so the
 * cell doesn't read "247d ago".
 */

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const THIRTY_DAYS = 30 * DAY;

/**
 * Render an ISO timestamp as a relative-time string.
 *
 *   < 60s   → "just now"
 *   < 60m   → "{n}m ago"
 *   < 24h   → "{n}h ago"
 *   < 30d   → "{n}d ago"
 *   ≥ 30d   → "DD MMM YYYY"  (en-IN)
 *
 * Returns "—" for null / undefined / unparseable input — leadership prefers
 * a dash over a parser stack trace.
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function fmtRelative(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";

  const diff = Date.now() - t;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < THIRTY_DAYS) return `${Math.floor(diff / DAY)}d ago`;

  return new Date(t).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
