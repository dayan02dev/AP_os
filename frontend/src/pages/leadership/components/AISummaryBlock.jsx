// AISummaryBlock — render an ai_screening row's summary + review flags.
//
// The runner persists ai_screening.summary as JSON.stringify of a
// Round1Summary (verdict, top_strength, top_concern, program_fit,
// recommendation). Legacy Phase-1 rows stored a plain "Stub mode…"
// string instead — parseSummary falls back to plain text for those.
//
// Layout (progressive disclosure): flags → a TL;DR header that always shows
// the two decision-driving pointers (Verdict + Recommendation) → the longer
// supporting sections (Top strength / Top concern / Programme fit) collapsed
// behind accordions so the panel/drawer isn't a wall of text. Also surfaces
// flags.needs_human_review and the cap-rule count so leadership knows when an
// auto-summary isn't trustworthy.

import Collapsible from "./Collapsible.jsx";

// Plain-text summaries (legacy rows or stub-mode) are a wall of text. Give
// them the same shape as structured summaries: lift the first sentence as a
// TL;DR "Summary" card (always visible), put the remainder behind a single
// "Full summary" accordion (collapsed by default) so the panel isn't dense.
function splitFirstSentence(text) {
  // Match up to the first sentence terminator followed by whitespace + a
  // capital (or end of string). Falls back to the whole string if no clean
  // boundary is found.
  const m = text.match(/^[\s\S]*?[.!?](?=\s+[A-Z]|\s*$)/);
  if (!m) return { first: text.trim(), rest: "" };
  return { first: m[0].trim(), rest: text.slice(m[0].length).trim() };
}

function PlainSummary({ text }) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const { first, rest } = splitFirstSentence(trimmed);
  return (
    <>
      <div className="ai-tldr">
        <div className="ai-tldr-item">
          <span className="ai-tldr-label">Summary</span>
          <p className="ai-tldr-text">{first}</p>
        </div>
      </div>
      {rest && (
        <div className="ai-detail-sections">
          <Collapsible label="Full summary">
            <p className="ai-tldr-text">{rest}</p>
          </Collapsible>
        </div>
      )}
    </>
  );
}

// Sections shown collapsed by default (the supporting detail).
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
          <PlainSummary text={parsed.text} />
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

      {/* TL;DR — the two pointers a reviewer acts on, always visible. */}
      <div className="ai-tldr">
        {data.verdict && (
          <div className="ai-tldr-item">
            <span className="ai-tldr-label">Verdict</span>
            <p className="ai-tldr-text">{data.verdict}</p>
          </div>
        )}
        {data.recommendation && (
          <div className="ai-tldr-item is-rec">
            <span className="ai-tldr-label">Recommendation</span>
            <p className="ai-tldr-text is-strong">{data.recommendation}</p>
          </div>
        )}
      </div>

      {/* Supporting detail — collapsed by default. */}
      {DETAIL_SECTIONS.some((s) => data[s.key]) && (
        <div className="ai-detail-sections">
          {DETAIL_SECTIONS.map((s) =>
            data[s.key] ? (
              <Collapsible key={s.key} label={s.label}>
                <p className="ai-tldr-text">{data[s.key]}</p>
              </Collapsible>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
