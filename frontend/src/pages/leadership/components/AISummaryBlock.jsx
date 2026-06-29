// AISummaryBlock — render an ai_screening row's summary + review flags.
//
// The runner persists ai_screening.summary as JSON.stringify of a
// Round1Summary (verdict, top_strength, top_concern, program_fit,
// recommendation). Legacy Phase-1 rows stored a plain "Stub mode…" string
// instead — parseSummary falls back to plain text for those.
//
// Layout: flags → Verdict (Read-more for long text) → Recommendation
// (emphasised) → Top strength / Top concern / Programme fit, all as
// always-visible labelled rows separated by hairlines. No accordions: the
// supporting detail is short, and hiding it behind a tap read as "messy".

import ReadMoreText from "./ReadMoreText.jsx";

// Supporting sections, always shown.
const DETAIL_SECTIONS = [
  { key: "top_strength", label: "Top strength" },
  { key: "top_concern", label: "Top concern" },
  { key: "program_fit", label: "Programme fit" },
];

function parseSummary(raw) {
  if (!raw) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && obj.verdict) {
        return { kind: "structured", data: obj };
      }
    } catch {}
  }
  return { kind: "plain", text: trimmed };
}

function Flags({ isStub, needsReview, capCount }) {
  if (!isStub && !needsReview && capCount === 0) return null;
  return (
    <div className="ai-flags">
      {isStub && <span className="ai-flag ai-flag-amber">STUB</span>}
      {needsReview && (
        <span
          className="ai-flag ai-flag-red"
          title="Synthesizer failed all 3 quality-gate retries — summary may not meet rubric. Review manually."
        >
          NEEDS HUMAN REVIEW
        </span>
      )}
      {capCount > 0 && (
        <span
          className="ai-flag ai-flag-amber"
          title="Deterministic cap rule(s) fired — scores have been clamped."
        >
          {capCount} CAP{capCount === 1 ? "" : "S"} APPLIED
        </span>
      )}
    </div>
  );
}

export default function AISummaryBlock({ aiScreening }) {
  if (!aiScreening) return null;
  const parsed = parseSummary(aiScreening.summary);
  const flags = aiScreening.flags || {};
  const needsReview = !!flags.needs_human_review;
  const capCount = Array.isArray(flags.cap_events) ? flags.cap_events.length : 0;
  const isStub = parsed?.kind === "plain" && /\bstub mode\b/i.test(parsed.text);

  if (parsed?.kind !== "structured") {
    return (
      <div className="ai-summary-block">
        <Flags isStub={isStub} needsReview={needsReview} capCount={capCount} />
        {parsed?.kind === "plain" ? (
          <p className="ai-summary-text">{parsed.text}</p>
        ) : (
          <p className="ai-summary-empty">No summary written yet.</p>
        )}
      </div>
    );
  }

  const data = parsed.data;
  return (
    <div className="ai-summary-block">
      <Flags isStub={isStub} needsReview={needsReview} capCount={capCount} />
      <div className="ai-summary-sections">
        {data.verdict && (
          <div className="ai-summary-row">
            <span className="ai-summary-label">Verdict</span>
            <ReadMoreText
              text={data.verdict}
              className="ai-summary-text"
              words={60}
            />
          </div>
        )}
        {data.recommendation && (
          <div className="ai-summary-row is-rec">
            <span className="ai-summary-label">Recommendation</span>
            <p className="ai-summary-text is-strong">{data.recommendation}</p>
          </div>
        )}
        {DETAIL_SECTIONS.map((s) =>
          data[s.key] ? (
            <div className="ai-summary-row" key={s.key}>
              <span className="ai-summary-label">{s.label}</span>
              <p className="ai-summary-text">{data[s.key]}</p>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
