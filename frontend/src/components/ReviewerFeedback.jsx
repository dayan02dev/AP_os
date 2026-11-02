// Shared renderers for the written feedback on an application:
//  - ReviewerFeedback: one reviewer's text (recommendation, notes, flags,
//    legacy strengths/concerns/comments, AI disagreements). Takes a RAW
//    `reviews` row (snake_case columns as the API returns them).
//  - AdminDecisionList: admin decisions + rationale (admin_decisions rows).
// Used by the leadership, admin and reviewer portals so all three show the
// same thing.

const RECO_LABEL = { yes: "Yes", maybe: "Maybe", no: "No" };
const RECO_CLASS = { yes: "fb-reco-yes", maybe: "fb-reco-maybe", no: "fb-reco-no" };

const DIM_LABEL = {
  problem: "Problem Statement Impact and Importance",
  solution: "Completeness, Depth of Solution",
  tech: "Technical Depth",
  founders: "Professional Profile of Founder",
  commit: "Commitment",
};

const DECISION_LABEL = {
  approved: "Approved",
  advanced: "Approved",
  rejected: "Rejected",
  on_hold: "On hold",
  hold: "On hold",
  waitlisted: "Waitlisted",
  offered: "Offered",
  jury_review: "Sent to final round",
};

const GATE_LABEL = { gate1: "1st gate", gate2: "Final round" };

const box = { fontSize: 14, lineHeight: 1.55, color: "var(--ink, #1a1a1a)", margin: "0 0 8px 0", whiteSpace: "pre-wrap" };
const lbl = { fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ink-soft, #666)", display: "block", marginBottom: 2 };

function Block({ label, children }) {
  return (
    <div className="fb-block" style={{ marginTop: 8 }}>
      <span className="fb-label" style={lbl}>{label}</span>
      <div style={box}>{children}</div>
    </div>
  );
}

function nonEmpty(s) {
  return typeof s === "string" && s.trim().length > 0;
}

export default function ReviewerFeedback({ review }) {
  if (!review) return null;
  const reco = (review.recommendation || "").toLowerCase();
  const flags = Array.isArray(review.flags) ? review.flags.filter(nonEmpty) : [];
  const disagree = review.disagree_with_ai && typeof review.disagree_with_ai === "object"
    ? Object.entries(review.disagree_with_ai).filter(([, v]) => nonEmpty(v))
    : [];
  const hasText = nonEmpty(review.quick_notes) || nonEmpty(review.strengths)
    || nonEmpty(review.concerns) || nonEmpty(review.comments)
    || flags.length > 0 || disagree.length > 0;

  return (
    <div className="reviewer-feedback" data-testid="reviewer-feedback">
      {RECO_LABEL[reco] && (
        <div style={{ marginTop: 8 }}>
          <span className="fb-label" style={lbl}>Recommendation</span>
          <span className={`fb-reco ${RECO_CLASS[reco]}`} style={{ fontWeight: 600 }}>{RECO_LABEL[reco]}</span>
        </div>
      )}
      {nonEmpty(review.quick_notes) && <Block label="Notes">{review.quick_notes}</Block>}
      {nonEmpty(review.strengths) && <Block label="Strengths">{review.strengths}</Block>}
      {nonEmpty(review.concerns) && <Block label="Concerns">{review.concerns}</Block>}
      {nonEmpty(review.comments) && <Block label="Comments">{review.comments}</Block>}
      {flags.length > 0 && (
        <Block label="Flags">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {flags.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </Block>
      )}
      {disagree.length > 0 && (
        <Block label="Disagrees with AI">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {disagree.map(([k, v]) => <li key={k}>{(DIM_LABEL[k] || k) + ": " + v}</li>)}
          </ul>
        </Block>
      )}
      {!hasText && (
        <p style={{ ...box, color: "var(--ink-soft, #666)", marginTop: 8 }}>No written feedback.</p>
      )}
    </div>
  );
}

// Rationales the backend writes automatically (decisions.py) carry no human
// feedback; they're hidden so only real admin comments show.
const AUTO_RATIONALE = [/^gate[12]\s*:/i, /^batch decision\b/i, /^admin override\s*:/i];
export function isAutoRationale(text) {
  if (!nonEmpty(text)) return true;
  return AUTO_RATIONALE.some((re) => re.test(text.trim()));
}

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export function AdminDecisionList({ decisions, title = "Admin decisions & feedback" }) {
  const rows = Array.isArray(decisions) ? decisions : [];
  if (rows.length === 0) return null;
  return (
    <section className="admin-decisions" data-testid="admin-decisions" style={{ marginTop: 16 }}>
      <span className="eyebrow" style={{ ...lbl, marginBottom: 8 }}>{title}</span>
      {rows.map((d, i) => {
        const auto = isAutoRationale(d.rationale);
        return (
          <article key={d.id || i} className="admin-decision-card review-card" style={{ marginBottom: 8 }}>
            <header className="review-card-head" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span className="review-card-name">
                {(DECISION_LABEL[d.decision] || d.decision || "Decision")}
                {GATE_LABEL[d.gate_stage] ? ` · ${GATE_LABEL[d.gate_stage]}` : ""}
              </span>
              <span className="review-card-when" style={{ color: "var(--ink-soft, #666)", fontSize: 13 }}>
                {d.decided_by_name ? `by ${d.decided_by_name}` : ""}{d.decided_at ? ` · ${fmtWhen(d.decided_at)}` : ""}
              </span>
            </header>
            {auto
              ? <p style={{ ...box, color: "var(--ink-soft, #666)" }}>No comment added.</p>
              : <p style={box}>{d.rationale}</p>}
          </article>
        );
      })}
    </section>
  );
}
