// AISummaryBlock — render an ai_screening row's summary + review flags.
//
// The runner persists ai_screening.summary as JSON.stringify of a
// Round1Summary (verdict, top_strength, top_concern, program_fit,
// recommendation). Legacy Phase-1 rows stored a plain "Stub mode…"
// string instead — parseSummary falls back to plain text for those.
//
// Also surfaces flags.needs_human_review (set when the synthesizer
// failed all 3 quality-gate retries) and the count of cap rules that
// fired, so leadership knows when an auto-summary isn't trustworthy.

const SECTIONS = [
  { key: "verdict",        label: "Verdict" },
  { key: "top_strength",   label: "Top strength" },
  { key: "top_concern",    label: "Top concern" },
  { key: "program_fit",    label: "Programme fit" },
  { key: "recommendation", label: "Recommendation" },
];

function parseSummary(raw) {
  if (!raw) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try JSON first.
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && obj.verdict) {
        return { kind: "structured", data: obj };
      }
    } catch {}
  }
  // Fallback: plain text (legacy stub-mode rows).
  return { kind: "plain", text: trimmed };
}

export default function AISummaryBlock({ aiScreening }) {
  if (!aiScreening) return null;
  const parsed = parseSummary(aiScreening.summary);
  const flags = aiScreening.flags || {};
  const needsReview = !!flags.needs_human_review;
  const capCount = Array.isArray(flags.cap_events) ? flags.cap_events.length : 0;
  const isStub = parsed?.kind === "plain" && /\bstub mode\b/i.test(parsed.text);

  return (
    <div className="ai-summary-block" style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
      {(needsReview || capCount > 0 || isStub) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {isStub && (
            <span
              style={{
                background: "var(--hl-amber, #fef3c7)",
                color: "#92400e",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              STUB
            </span>
          )}
          {needsReview && (
            <span
              style={{
                background: "#fee2e2",
                color: "#991b1b",
                padding: "2px 8px",
                borderRadius: 999,
              }}
              title="Synthesizer failed all 3 quality-gate retries — summary may not meet rubric. Review manually."
            >
              NEEDS HUMAN REVIEW
            </span>
          )}
          {capCount > 0 && (
            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                padding: "2px 8px",
                borderRadius: 999,
              }}
              title="Deterministic cap rule(s) fired — scores have been clamped."
            >
              {capCount} CAP{capCount === 1 ? "" : "S"} APPLIED
            </span>
          )}
        </div>
      )}

      {parsed?.kind === "structured" ? (
        SECTIONS.map((s) => {
          const v = parsed.data[s.key];
          if (!v) return null;
          return (
            <div key={s.key}>
              <span
                className="section-eyebrow"
                style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-dim)" }}
              >
                {s.label}
              </span>
              <p
                style={{
                  marginTop: 4,
                  marginBottom: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: s.key === "recommendation" ? "var(--ink)" : "var(--ink-soft)",
                  fontWeight: s.key === "recommendation" ? 600 : 400,
                }}
              >
                {v}
              </p>
            </div>
          );
        })
      ) : parsed?.kind === "plain" ? (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--ink-soft)" }}>
          {parsed.text}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
          No summary written yet.
        </p>
      )}
    </div>
  );
}
