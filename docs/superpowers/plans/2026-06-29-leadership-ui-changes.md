# Leadership UI changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the leadership review surfaces — redesign the AI Screening sidebar (card stack), show each reviewer's weighted overall score, and remove the Unassign button.

**Architecture:** Frontend-only React/Vite changes on the leadership surface. A new pure helper computes the reviewer weighted score; the shared `AISummaryBlock` is restructured (no accordions); `AIScreeningPanel` + `AppDrawer` get a card-stack layout via CSS; the Unassign button + its dead plumbing are removed.

**Tech Stack:** React 18, Vite, plain CSS, Vitest + @testing-library/react (use `fireEvent`, NOT `@testing-library/user-event` — it is unresolved in this repo).

**Branch:** Work in the existing worktree on `release/sip-launch-v1` (where the spec commit `b9f4c8b` already lives). Commit per task. No backend, no migration. Spec: `docs/superpowers/specs/2026-06-29-leadership-ui-changes-design.md`.

**Pre-existing test note:** `src/pages/leadership/review/answers/__tests__/FileGridAnswer.test.jsx` fails to collect (unrelated missing dep). All OTHER suites pass. Do not try to fix it.

---

## Task 1: `weightedReviewScore` helper (Change 2 core)

**Files:**
- Create: `frontend/src/lib/reviewScore.js`
- Test: `frontend/src/lib/__tests__/reviewScore.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/__tests__/reviewScore.test.js
import { describe, it, expect } from "vitest";
import { weightedReviewScore } from "../reviewScore";

describe("weightedReviewScore", () => {
  it("computes the weighted overall using canonical weights", () => {
    // 2.0*22 + 2.0*30 + 1.5*22 + 3.0*14 + 2.5*12 = 209; /100 = 2.09
    const r = {
      score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
      score_founders: 3.0, score_commitment: 2.5,
    };
    expect(weightedReviewScore(r)).toBeCloseTo(2.09, 2);
  });

  it("returns null when no dimension scores are present", () => {
    expect(weightedReviewScore({})).toBeNull();
    expect(weightedReviewScore(null)).toBeNull();
    expect(weightedReviewScore(undefined)).toBeNull();
  });

  it("renormalises over only the present dimensions", () => {
    expect(weightedReviewScore({ score_problem: 7 })).toBeCloseTo(7, 5);
  });

  it("ignores non-numeric values", () => {
    const r = { score_problem: 8, score_solution: null, score_tech: "x" };
    expect(weightedReviewScore(r)).toBeCloseTo(8, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/reviewScore.test.js`
Expected: FAIL — `Failed to resolve import "../reviewScore"` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```js
// frontend/src/lib/reviewScore.js
// Weighted overall for a reviewer's submitted review — the canonical "signal
// score" a reviewer sees as "My Score" in their own portal. Mirrors
// frontend/src/pages/reviewer/v2/ui.jsx `weightedOverall` and the backend
// `reviewer_query._SCORE_WEIGHTS`. Lives in lib/ so the leadership surface does
// NOT import from the reviewer-portal module.
//
// `score_solution` is the DB column for the "Completeness / depth of solution"
// dimension (legacy name kept) and carries weight 30.

const WEIGHTED_DIMS = [
  { col: "score_problem", weight: 22 },
  { col: "score_solution", weight: 30 },
  { col: "score_tech", weight: 22 },
  { col: "score_founders", weight: 14 },
  { col: "score_commitment", weight: 12 },
];

export function weightedReviewScore(review) {
  if (!review || typeof review !== "object") return null;
  let total = 0;
  let wsum = 0;
  for (const { col, weight } of WEIGHTED_DIMS) {
    const v = review[col];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    total += v * weight;
    wsum += weight;
  }
  return wsum ? total / wsum : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/reviewScore.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/reviewScore.js frontend/src/lib/__tests__/reviewScore.test.js
git commit -m "feat(leadership): weightedReviewScore helper for reviewer signal score"
```

---

## Task 2: Show weighted score on the Reviews tab (Change 2)

**Files:**
- Modify: `frontend/src/pages/leadership/review/ReviewsTab.jsx`
- Modify: `frontend/src/styles/review-application.css` (add `.review-card-score`)
- Test: `frontend/src/pages/leadership/review/__tests__/ReviewsTab.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/leadership/review/__tests__/ReviewsTab.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewsTab from "../ReviewsTab.jsx";

const review = {
  id: "rv1",
  reviewer_name: "Udita Uniyal",
  status: "submitted",
  submitted_at: "2026-06-27T17:05:00Z",
  score_problem: 2.0, score_solution: 2.0, score_tech: 1.5,
  score_founders: 3.0, score_commitment: 2.5,
};

describe("ReviewsTab reviewer weighted score", () => {
  it("shows the reviewer's weighted overall on the card", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    // weighted = 2.09 → 2.1
    expect(
      screen.getByLabelText(/Reviewer weighted score 2\.1 out of 10/i),
    ).toBeInTheDocument();
  });

  it("shows the avg score line computed from the weighted overall", () => {
    render(<ReviewsTab reviews={[review]} assignments={[{ reviewer_user_id: "u1" }]} />);
    expect(screen.getByText(/avg score/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/leadership/review/__tests__/ReviewsTab.test.jsx`
Expected: FAIL — no element matching the weighted-score aria-label (the card has no overall yet) and the avg line is absent (today `r.score_overall` is undefined so `avg` is null).

- [ ] **Step 3: Edit `ReviewsTab.jsx`**

Add the import at the top (after the existing `reviewerStatus` import):

```jsx
import { weightedReviewScore } from "../../../lib/reviewScore.js";
```

Replace the `overalls` / `avg` block:

```jsx
  const overalls = submittedReviews
    .map((r) => r.score_overall)
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  const avg =
    overalls.length > 0
      ? (overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1)
      : null;
```

with:

```jsx
  const overalls = submittedReviews
    .map((r) => weightedReviewScore(r))
    .filter((s) => typeof s === "number" && Number.isFinite(s));
  const avg =
    overalls.length > 0
      ? (overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(1)
      : null;
```

Replace the card `.map(...)` body so each card computes its overall and renders it in the header. Replace this block:

```jsx
          {submittedReviews.map((r) => (
            <article
              key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
              className="review-card"
            >
              <header className="review-card-head">
                <span className="review-card-name">
                  Reviewer · {reviewerNameOf(r)}
                </span>
                <span className="review-card-when">{fmtDate(r.submitted_at)}</span>
              </header>
```

with:

```jsx
          {submittedReviews.map((r) => {
            const overall = weightedReviewScore(r);
            return (
            <article
              key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
              className="review-card"
            >
              <header className="review-card-head">
                <span className="review-card-name">
                  Reviewer · {reviewerNameOf(r)}
                </span>
                <span className="review-card-head-right">
                  {typeof overall === "number" && (
                    <span
                      className="review-card-score"
                      aria-label={`Reviewer weighted score ${overall.toFixed(1)} out of 10`}
                    >
                      {overall.toFixed(1)}<span className="of">/10</span>
                    </span>
                  )}
                  <span className="review-card-when">{fmtDate(r.submitted_at)}</span>
                </span>
              </header>
```

Then close the new arrow-function body: change the map's closing `))}` (the one that closes the `<article>` for submitted reviews) to `);})}`. Concretely, replace:

```jsx
            </article>
          ))}
        </div>
      )}
```

with:

```jsx
            </article>
            );
          })}
        </div>
      )}
```

- [ ] **Step 4: Add CSS** in `frontend/src/styles/review-application.css`

Find the `.review-card-when` rule and add directly after it:

```css
.review-card-head-right {
  display: inline-flex;
  align-items: baseline;
  gap: var(--s-3);
}
.review-card-score {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 18px;
  color: var(--artblue, var(--accent));
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.review-card-score .of {
  font-size: 11px;
  font-weight: 400;
  color: var(--ink-dim);
  margin-left: 2px;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/leadership/review/__tests__/ReviewsTab.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/leadership/review/ReviewsTab.jsx \
  frontend/src/pages/leadership/review/__tests__/ReviewsTab.test.jsx \
  frontend/src/styles/review-application.css
git commit -m "feat(leadership): show reviewer weighted score on Reviews tab"
```

---

## Task 3: Use weighted score in the dashboard drawer's Reviews list (Change 2)

**Files:**
- Modify: `frontend/src/pages/leadership/components/AppDrawer.jsx`

(No unit test — `AppDrawer` fetches on mount via `leadershipApi`, so it's verified by build + the helper's own test.)

- [ ] **Step 1: Add the import** in `AppDrawer.jsx` (after the `ReadMoreText` import):

```jsx
import { weightedReviewScore } from "../../../lib/reviewScore.js";
```

- [ ] **Step 2: Edit the Reviews `.map`** so each row computes the weighted overall. Replace:

```jsx
                {reviews.map((r) => (
                  <li
                    key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
                    style={{
                      padding: "var(--s-3) var(--s-4)",
                      background: "var(--paper-soft)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-sharp)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong style={{ fontSize: 14 }}>
                        {reviewerNameOf(r)}
                      </strong>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
                        {fmtDate(r.submitted_at)}
                      </span>
                    </div>
                    {r.score_overall != null && (
                      <div style={{ marginTop: 6, fontSize: 14 }}>
                        <strong>{r.score_overall.toFixed(1)}</strong> / 10
                        {r.recommendation && <> · {r.recommendation}</>}
                      </div>
                    )}
```

with:

```jsx
                {reviews.map((r) => {
                  const overall = weightedReviewScore(r);
                  return (
                  <li
                    key={r.id || `${r.reviewer_user_id}-${r.submitted_at}`}
                    style={{
                      padding: "var(--s-3) var(--s-4)",
                      background: "var(--paper-soft)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-sharp)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <strong style={{ fontSize: 14 }}>
                        {reviewerNameOf(r)}
                      </strong>
                      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
                        {fmtDate(r.submitted_at)}
                      </span>
                    </div>
                    {overall != null && (
                      <div style={{ marginTop: 6, fontSize: 14 }}>
                        <strong>{overall.toFixed(1)}</strong> / 10
                        {r.recommendation && <> · {r.recommendation}</>}
                      </div>
                    )}
```

Then close the new arrow body — replace the matching list-item close:

```jsx
                  </li>
                ))}
              </ul>
            )}
            </Collapsible>

            <Collapsible label="Status history" hint={history.length}>
```

with:

```jsx
                  </li>
                  );
                })}
              </ul>
            )}
            </Collapsible>

            <Collapsible label="Status history" hint={history.length}>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/leadership/components/AppDrawer.jsx
git commit -m "feat(leadership): weighted reviewer score in dashboard drawer reviews"
```

---

## Task 4: Restructure `AISummaryBlock` — no accordions (Change 1c)

The shared summary renders Verdict + Recommendation + Top strength / Top concern / Programme fit as always-visible labeled rows (no `Collapsible`). Long verdict gets a `ReadMoreText` so it can't blow out the panel.

**Files:**
- Modify: `frontend/src/pages/leadership/components/AISummaryBlock.jsx`
- Modify: `frontend/src/styles/review-application.css` (add `.ai-summary-row` etc.)
- Test: `frontend/src/pages/leadership/components/__tests__/AISummaryBlock.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/leadership/components/__tests__/AISummaryBlock.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AISummaryBlock from "../AISummaryBlock.jsx";

const aiScreening = {
  summary: JSON.stringify({
    verdict: "Affordable elder-care companion, still pre-pilot.",
    recommendation: "Do not advance to jury.",
    top_strength: "Affordability-first design.",
    top_concern: "No deployed traction.",
    program_fit: "Partial fit.",
  }),
  flags: {},
};

describe("AISummaryBlock structured summary", () => {
  it("shows verdict, recommendation, strength, concern and fit WITHOUT any accordion", () => {
    render(<AISummaryBlock aiScreening={aiScreening} />);
    expect(screen.getByText(/Affordable elder-care companion/i)).toBeInTheDocument();
    expect(screen.getByText(/Do not advance to jury/i)).toBeInTheDocument();
    expect(screen.getByText(/Affordability-first design/i)).toBeInTheDocument();
    expect(screen.getByText(/No deployed traction/i)).toBeInTheDocument();
    expect(screen.getByText(/Partial fit/i)).toBeInTheDocument();
    // no collapsed accordion headers (the supporting sections are always shown)
    expect(screen.queryByText("▸")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/leadership/components/__tests__/AISummaryBlock.test.jsx`
Expected: FAIL — today strength/concern/fit are inside collapsed `Collapsible` accordions, so their text is not rendered (the `▸` chevron is present), so the strength/concern/fit assertions and the no-`▸` assertion fail.

- [ ] **Step 3: Rewrite `AISummaryBlock.jsx`**

Replace the entire file with:

```jsx
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
```

- [ ] **Step 4: Add CSS** in `frontend/src/styles/review-application.css`

Find the `.ai-panel .ai-tldr { background: var(--paper); }` rule and replace it with:

```css
/* Summary detail rows — always visible, hairline-separated (no accordions). */
.ai-summary-sections {
  display: flex;
  flex-direction: column;
}
.ai-summary-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}
.ai-summary-row:last-child { border-bottom: none; }
.ai-summary-row.is-rec {
  border-bottom: none;
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  margin: 4px 0;
}
.ai-summary-label {
  display: block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 3px;
}
.ai-summary-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink);
}
.ai-summary-text.is-strong { font-weight: 600; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/leadership/components/__tests__/AISummaryBlock.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/leadership/components/AISummaryBlock.jsx \
  frontend/src/pages/leadership/components/__tests__/AISummaryBlock.test.jsx \
  frontend/src/styles/review-application.css
git commit -m "refactor(leadership): AI summary as always-visible rows, drop accordions"
```

---

## Task 5: `AIScreeningPanel` card stack + wider rail (Change 1a/1b)

Restructure the Score tab into a Score card (compact score header + band chip + bars) and a Summary card (the restructured `AISummaryBlock`). Widen the rail 440px → 500px.

**Files:**
- Modify: `frontend/src/pages/leadership/review/AIScreeningPanel.jsx`
- Modify: `frontend/src/styles/review-application.css`
- Test: `frontend/src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AIScreeningPanel from "../AIScreeningPanel.jsx";

const aiScreening = {
  score_overall: 3.9,
  score_problem: 4.0, score_completeness: 3.5, score_tech: 4.2,
  score_founders: 3.6, score_commitment: 4.1,
  summary: JSON.stringify({ verdict: "v", recommendation: "r", top_strength: "s" }),
  flags: {},
};

describe("AIScreeningPanel score tab", () => {
  it("renders the compact composite score and a strength band", () => {
    render(<AIScreeningPanel aiScreening={aiScreening} assignments={[]} />);
    expect(
      screen.getByLabelText(/Composite AI score 3\.9 out of 10/i),
    ).toBeInTheDocument();
    // band label derived from the score tier (3.9 → "Low")
    expect(screen.getByText(/Low/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx`
Expected: FAIL — there is no band label yet (only a "Strong" chip appears when score ≥ 8), so `/Low/i` is not found.

- [ ] **Step 3: Edit `AIScreeningPanel.jsx`**

Add a band helper above `ScoreTab` (mirrors the leadership dashboard `ScorePill` tiers high≥7 / mid≥5 / low≥3 / weak):

```jsx
function bandFor(score) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score >= 7) return "High";
  if (score >= 5) return "Mid";
  if (score >= 3) return "Low";
  return "Weak";
}
```

Replace the whole `ScoreTab` function with:

```jsx
function ScoreTab({ aiScreening }) {
  const overall = aiScreening?.score_overall;
  const hasOverall = typeof overall === "number" && Number.isFinite(overall);
  const band = hasOverall ? bandFor(overall) : null;
  return (
    <div className="ai-panel-body">
      <div className="ai-card">
        <div className="ai-score-head">
          <span
            className="ai-score-num"
            aria-label={hasOverall ? `Composite AI score ${overall.toFixed(1)} out of 10` : "Composite AI score not available"}
          >
            {hasOverall ? overall.toFixed(1) : "—"}
            <span className="of">/ 10</span>
          </span>
          {band && <span className={`ai-band ai-band-${band.toLowerCase()}`}>{band}</span>}
        </div>
        {!hasOverall && (
          <p className="ai-score-blurb">AI screening not run yet.</p>
        )}
        <div className="ai-bars">
          {CATEGORY_BARS.map((c) => {
            const v = aiScreening?.[c.key];
            const pct = typeof v === "number" ? (v / 10) * 100 : 0;
            return (
              <div key={c.key} className="ai-bar-row">
                <span className="label">{c.label}</span>
                <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
                <span className="num">{typeof v === "number" ? v.toFixed(1) : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>

      {aiScreening?.summary && (
        <div className="ai-card ai-summary">
          <div className="head">AI Summary</div>
          <AISummaryBlock aiScreening={aiScreening} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Edit `review-application.css`**

Change the rail width — replace:

```css
.review-body {
  display: grid;
  grid-template-columns: 1fr 440px;
```

with (keep any other properties in that rule unchanged):

```css
.review-body {
  display: grid;
  grid-template-columns: 1fr 500px;
```

Add card + compact-score + band styles. Find the `.ai-panel-body` rule and add directly after it:

```css
.ai-card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-sharp);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}
.ai-card.ai-summary { gap: 0; }
.ai-score-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
}
.ai-score-num {
  font-family: var(--font-serif, var(--font-display));
  font-weight: 700;
  font-size: 34px;
  line-height: 1;
  color: var(--accent);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.ai-score-num .of {
  font-size: 13px;
  font-weight: 400;
  color: var(--ink-dim);
  font-family: var(--font-body);
  margin-left: 4px;
}
.ai-band {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 9px;
  border-radius: var(--r-sharp);
  background: var(--bg-soft);
  color: var(--ink-soft);
}
.ai-band-high { background: var(--accent-soft); color: var(--accent); }
.ai-band-weak { background: #fdecec; color: #b42318; }
.ai-bars { display: flex; flex-direction: column; }
```

Tighten the bar rows — replace the `.ai-bar-row` rule:

```css
.ai-bar-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-3) 0;
  border-bottom: 1px dashed var(--line);
}
```

with:

```css
.ai-bar-row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.ai-bars .ai-bar-row:last-child { border-bottom: none; }
```

Update the `.ai-summary` block — replace:

```css
.ai-summary {
  /* Plain container — AISummaryBlock now supplies its own TL;DR card and
     collapsible sections, so no nested card background/border here. */
  padding: 0;
  background: transparent;
  border: none;
}
```

with:

```css
.ai-summary .head {
  /* AISummaryBlock supplies the structured rows; this is just the card label. */
  margin-bottom: var(--s-2);
}
```

(Keep the existing `.ai-summary .head` typography rule below it as-is.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx`
Expected: PASS (1 test).

- [ ] **Step 6: Build to confirm CSS/JSX integrity**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/leadership/review/AIScreeningPanel.jsx \
  frontend/src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx \
  frontend/src/styles/review-application.css
git commit -m "feat(leadership): AI screening panel card-stack layout + wider rail"
```

---

## Task 6: Drawer AI-score header + Problem/Solution parity (Change 1d)

Make the dashboard drawer's AI-score block match the panel's compact treatment, and tidy the Problem & solution section's typography/spacing.

**Files:**
- Modify: `frontend/src/pages/leadership/components/AppDrawer.jsx`

(No unit test — verified by build; `AppDrawer` fetches on mount.)

- [ ] **Step 1: Compact the drawer AI score** in `AppDrawer.jsx`. Replace:

```jsx
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s-3)" }}>
              <strong
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 44,
                  color: aiScreening?.score_overall != null ? "var(--artblue)" : "var(--ink-dim)",
                  lineHeight: 1,
                }}
              >
                {aiScreening?.score_overall != null ? aiScreening.score_overall.toFixed(1) : "—"}
              </strong>
              <span style={{ color: "var(--ink-dim)", fontSize: 14 }}>
                / 10 overall
              </span>
            </div>
```

with:

```jsx
            <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s-2)" }}>
              <strong
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 34,
                  color: aiScreening?.score_overall != null ? "var(--artblue)" : "var(--ink-dim)",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {aiScreening?.score_overall != null ? aiScreening.score_overall.toFixed(1) : "—"}
              </strong>
              <span style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                / 10 overall
              </span>
            </div>
```

- [ ] **Step 2: Tidy `renderProblemSolution`** spacing/typography. Replace the field heading inline style block:

```jsx
          <div style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 19,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            marginBottom: "var(--s-3, 12px)",
          }}>
            {titleCase(k.replace(/_/g, " "))}
          </div>
```

with (smaller, label-style heading consistent with the rest of the drawer):

```jsx
          <div style={{
            fontFamily: "var(--font-body)",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-dim)",
            marginBottom: "var(--s-2, 8px)",
          }}>
            {titleCase(k.replace(/_/g, " "))}
          </div>
```

And reduce the gap between fields — replace:

```jsx
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-6, 24px)" }}>
```

with:

```jsx
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4, 16px)" }}>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/leadership/components/AppDrawer.jsx
git commit -m "feat(leadership): drawer AI-score + problem/solution polish to match panel"
```

---

## Task 7: Remove the Unassign button + dead plumbing (Change 3)

**Files:**
- Modify: `frontend/src/pages/leadership/review/AIScreeningPanel.jsx`
- Modify: `frontend/src/pages/leadership/ReviewApplicationPage.jsx`
- Modify: `frontend/src/styles/review-application.css` (remove `.ai-unassign`)
- Test: extend `frontend/src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx`

- [ ] **Step 1: Add the failing test** — append to `AIScreeningPanel.test.jsx`:

```jsx
describe("AIScreeningPanel reviewers tab", () => {
  it("does not render an Unassign button", () => {
    const assignments = [
      { id: "a1", reviewer_user_id: "u1", reviewer_name: "Udita Uniyal", reviewer_status: "evaluated" },
    ];
    render(<AIScreeningPanel aiScreening={null} assignments={assignments} />);
    // Reviewers tab must be opened; default tab is "score".
    // Switch tabs:
    const tabBtn = screen.getByRole("button", { name: /^Reviewers$/i });
    fireEvent.click(tabBtn);
    expect(screen.queryByRole("button", { name: /Unassign/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx`
Expected: FAIL — the Unassign button is still rendered in the Reviewers tab.

- [ ] **Step 3: Edit `AIScreeningPanel.jsx`** — simplify `ReviewersTab` (drop the button + unused props):

Replace the whole `ReviewersTab` function with:

```jsx
function ReviewersTab({ assignments }) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return (
      <div className="ai-panel-body">
        <p className="ai-score-blurb">No reviewers assigned yet.</p>
      </div>
    );
  }
  return (
    <div className="ai-panel-body">
      {assignments.map((a) => {
        const dotCls = reviewerStatusDot(a);
        return (
          <div
            key={a.id || `${a.reviewer_user_id}-${a.assigned_at}`}
            className="ai-reviewer-row"
          >
            <span>
              <span className="name">Reviewer · {reviewerNameOf(a)}</span>
              <div className="state">
                <span className={`dot ${dotCls}`} />
                {reviewerStatusLabel(a)}
              </div>
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

Update the default-export signature + the `ReviewersTab` render call. Replace:

```jsx
export default function AIScreeningPanel({
  aiScreening,
  assignments,
  onUnassign,
  onClose,
  unassigning,
  currentUserId,
}) {
```

with:

```jsx
export default function AIScreeningPanel({
  aiScreening,
  assignments,
  onClose,
}) {
```

And replace:

```jsx
      {tab === "reviewers" && (
        <ReviewersTab
          assignments={assignments}
          onUnassign={onUnassign}
          unassigning={unassigning}
          currentUserId={currentUserId}
        />
      )}
```

with:

```jsx
      {tab === "reviewers" && <ReviewersTab assignments={assignments} />}
```

- [ ] **Step 4: Edit `ReviewApplicationPage.jsx`** — remove the dead unassign plumbing.

Remove the `unassigning` state line:

```jsx
  const [unassigning, setUnassigning] = useState(null);
```

Remove the entire `handleUnassign` callback:

```jsx
  const handleUnassign = useCallback(async (assignment) => {
    if (!assignment?.reviewer_user_id) return;
    if (!window.confirm(`Remove reviewer ${assignment.reviewer_user_id.slice(0, 8)} from this application?`)) {
      return;
    }
    setUnassigning(assignment.reviewer_user_id);
    try {
      await leadershipApi.unassignReviewer(id, track, assignment.reviewer_user_id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      const code = err?.details?.code || err?.code;
      const msg = err?.details?.message || err?.message || "Failed to unassign reviewer.";
      if (code === "review_already_submitted") {
        window.alert("This reviewer has already submitted a review and can't be unassigned in Phase 1.");
      } else {
        window.alert(msg);
      }
    } finally {
      setUnassigning(null);
    }
  }, [id, track]);
```

Update the `<AIScreeningPanel ... />` usage — replace:

```jsx
        {!asideCollapsed && (
          <AIScreeningPanel
            aiScreening={aiScreening}
            assignments={assignments}
            onUnassign={handleUnassign}
            onClose={toggleAside}
            unassigning={unassigning}
            currentUserId={user?.id || null}
          />
        )}
```

with:

```jsx
        {!asideCollapsed && (
          <AIScreeningPanel
            aiScreening={aiScreening}
            assignments={assignments}
            onClose={toggleAside}
          />
        )}
```

Note: `useAuth` / `user` may now be unused. After editing, check: if `user` is referenced nowhere else, remove `const { user } = useAuth();` and the `useAuth` import. (Verify with a grep in Step 6.)

- [ ] **Step 5: Remove dead CSS** — in `review-application.css`, delete the `.ai-unassign`, `.ai-unassign:hover`, and `.ai-unassign:disabled` rules.

- [ ] **Step 6: Verify usage + run tests + build**

```bash
cd frontend
# confirm no dangling references
grep -rn "onUnassign\|handleUnassign\|ai-unassign\|unassigning" src/pages/leadership/ || echo "clean"
# is `user` still used in ReviewApplicationPage? if this prints only the import/declaration, remove them
grep -n "user" src/pages/leadership/ReviewApplicationPage.jsx
npx vitest run src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx
npm run build
```
Expected: grep shows "clean" for unassign refs; AIScreeningPanel tests PASS (2 tests now); build succeeds.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/leadership/review/AIScreeningPanel.jsx \
  frontend/src/pages/leadership/ReviewApplicationPage.jsx \
  frontend/src/styles/review-application.css \
  frontend/src/pages/leadership/review/__tests__/AIScreeningPanel.test.jsx
git commit -m "feat(leadership): remove Unassign button from reviewers tab"
```

---

## Task 8: Full verification + finishing

**Files:** none (verification only)

- [ ] **Step 1: Full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all suites pass EXCEPT the pre-existing `FileGridAnswer.test.jsx` collection failure (unrelated). New suites green: `reviewScore`, `ReviewsTab`, `AISummaryBlock`, `AIScreeningPanel`.

- [ ] **Step 2: Production build**

Run: `cd frontend && npm run build`
Expected: build succeeds; note the new bundle hash.

- [ ] **Step 3: Visual checklist** (manual, against the spec)

- Review page → right rail Score tab: compact score (34px) + band chip, bars in a card with hairline dividers, AI Summary card with Verdict (read-more if long) / Recommendation (accented) / Top strength / Top concern / Programme fit all visible, no accordions; rail is ~500px wide.
- Review page → Reviews tab: each card header shows `Reviewer · NAME` with the weighted `X.X /10`; the summary line shows `avg score`.
- Review page → right rail Reviewers tab: reviewer name + status dot, NO Unassign button.
- Dashboard → click a row → drawer: compact AI score (34px), tidy Problem & solution, Reviews list shows the weighted per-reviewer score.

- [ ] **Step 4: Finish the branch**

Use the **superpowers:finishing-a-development-branch** skill. Since this work is on `release/sip-launch-v1` (the deploy branch), the expected outcome is: push to origin, then the user promotes the new build on Vercel (frontend-only, no backend deploy). Confirm with the user before pushing.

---

## Notes / invariants for the implementer

- **Do NOT** import `weightedOverall` from `pages/reviewer/v2/ui.jsx` — use the new `lib/reviewScore.js` (avoids cross-surface coupling). The weights MUST stay `{problem:22, solution:30, tech:22, founders:14, commit:12}` to match the reviewer portal + backend `_SCORE_WEIGHTS`.
- The reviews table uses column `score_solution` for the "Completeness / depth of solution" dimension (legacy name) — that is correct, not a typo.
- `AISummaryBlock` is shared by both the panel (lavender bg) and the drawer (white bg) — keep container chrome in CSS, not the component.
- Leave the backend `unassignReviewer` endpoint and `leadershipApi.unassignReviewer` intact (admin still uses them).
- Use `fireEvent`/`.click()` in tests, never `@testing-library/user-event` (unresolved in this repo).
