# VIP Phase 4 — AIR wizard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 24-line `FounderTlr.jsx` placeholder with the five-step AIR evaluation wizard that spec §4.4 describes, driven entirely by the catalog the backend already serves.

**Architecture:** One `GET /founder/air` returns the framework *and* the venture's answers in a single bundle, so the wizard holds one state object and never hardcodes a lever, question, option or criterion. Per-lever edits autosave through `PUT /founder/air/levers/{lever}` using the optimistic-then-PATCH idiom the TIR tabs already use. Evidence upload is multipart. Step 05 is the submit gate.

**Tech Stack:** React 18, react-router-dom, Vitest + @testing-library/react, the existing `founderApi` client and `Stepper` component.

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` (§4.3, §4.4, §4.5)

**State doc:** `docs/superpowers/VIP_BUILD_STATE.md` — read its "Founder UI conventions" section before Task 1.

## Global Constraints

- **Backend is frozen.** Phase 2 shipped and reviewed the AIR backend. This phase adds no endpoint, changes no response shape, and touches nothing under `backend/`. If the UI appears to need a backend change, stop and raise it — do not edit the router.
- **Nothing about the framework is hardcoded in the frontend.** Levers, question text, option text, option ids, criteria, document names and level numbers all come from `bundle.catalog`. The spec's reason: wording changes must not need a frontend deploy. A test asserts a renamed catalog entry flows through to the screen.
- **Reuse `Stepper.jsx` as-is.** It already implements active/done/default circles, connectors and the progress bar. Do not fork or restyle it.
- **Autosave, no save buttons on field edits.** Optimistic `setState`, fire the request, put failures in a non-blocking `actionError` banner. Pattern: `FounderApproach.jsx:64-100`.
- **CSS classes only** — `fj-*`, `tile`, `eyebrow`, and what `ui.jsx` exports. No new inline style objects beyond `ui.jsx`'s own idiom.
- **`draft` is the only editable state.** When `bundle.round.status !== "draft"`, every input is disabled and the wizard reads as a record. Reads stay available in every state — including evidence download.
- Never put Co-Authored-By, Claude, Anthropic or any AI reference in a commit message. Commits are solely authored by the repo owner.
- Frontend tests run with `cd frontend && npx vitest run`. Every task ends green.

## The one thing that will confuse a founder if you get it wrong

`air_scoring.lever_level` is a **ladder**: it walks q1 → q2 → q3 and stops the moment a question is answered below its own maximum. So answering q3 at level 8 while q1 sits below its top option contributes **nothing** — the level stays where the ladder broke.

That is correct and deliberate, but silently correct. A founder who picks the best q3 option and watches the level not move will think the form is broken.

**The wizard must show the ladder, not hide it.** Each lever panel states which question is currently capping the level, and the level chip explains itself: "AIR 3 — lifted by Q2. Q3 will count once Q2 is at its top option." Task 3 specifies this exactly. Do not treat it as decoration; it is the single highest-value piece of UI in this phase.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/lib/founderApi.js` | *Modify.* Add the six AIR thunks. |
| `frontend/src/pages/founder/components/AirBar.jsx` | *Create.* One lever as a horizontal 1-9 bar, verified solid + claimed ghost. Built standalone because Phase 6's dashboard scorecard reuses it. |
| `frontend/src/pages/founder/components/LeverPanel.jsx` | *Create.* One lever's three radio questions, criteria checklist, and the ladder-aware level chip. |
| `frontend/src/pages/founder/components/EvidenceRow.jsx` | *Create.* Per-lever required-document row: upload, replace, download, delete. |
| `frontend/src/pages/founder/FounderTlr.jsx` | *Rewrite.* The five-step wizard shell and submit gate. |
| `frontend/src/pages/founder/__tests__/FounderTlr.test.jsx` | *Create.* Wizard behaviour. |
| `frontend/src/pages/founder/__tests__/LeverPanel.test.jsx` | *Create.* Ladder messaging and criteria. |

---

### Task 1: `founderApi` AIR thunks

**Files:**
- Modify: `frontend/src/lib/founderApi.js`

**Interfaces:**
- Consumes: the `api` helper already imported at the top of the file.
- Produces: `founderApi.getAir`, `putAirLever`, `submitAir`, `uploadAirEvidence`, `delAirEvidence`, `airEvidenceSignedUrl` — every later task mocks these by name.

- [ ] **Step 1: Read the file and the multipart precedent**

`founderApi.js` is a flat object of thunks. Find how an existing multipart upload is done in this codebase before writing `uploadAirEvidence` — grep `frontend/src/lib/` for `FormData`. Match that precedent; do not set `Content-Type` by hand (the boundary must be browser-generated).

- [ ] **Step 2: Add the block**

Append to the `founderApi` object, keeping the file's comment-per-group style:

```js
  // ---- AIR (VIP TLR evaluation) ----
  getAir: () => api.get("/founder/air"),
  putAirLever: (lever, payload) => api.put(`/founder/air/levers/${lever}`, payload),
  submitAir: () => api.post("/founder/air/submit"),
  delAirEvidence: (id) => api.del(`/founder/air/evidence/${id}`),
  airEvidenceSignedUrl: (id) => api.get(`/founder/air/evidence/${id}/signed-url`),
```

`uploadAirEvidence(lever, airLevel, file)` posts multipart to `/founder/air/evidence` with fields `file`, `lever`, `air_level` — those exact field names, they are what `upload_evidence` reads via `Form(...)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/founderApi.js
git commit -m "feat(vip): founderApi thunks for the AIR endpoints"
```

---

### Task 2: `AirBar` — one lever on a 1-9 scale

**Files:**
- Create: `frontend/src/pages/founder/components/AirBar.jsx`
- Test: `frontend/src/pages/founder/__tests__/AirBar.test.jsx`

**Interfaces:**
- Produces: `<AirBar name claimed verified max={9} />`. `claimed` and `verified` are `number | null`. Phase 6 reuses this unchanged — keep it presentational, no data fetching, no `founderApi` import.

**Behaviour:**
- Nine segments. Segments up to `verified` render solid; segments between `verified` and `claimed` render as the ghost/hatched treatment; the rest are empty.
- `verified == null` (nothing verified yet) → no solid segments, ghost runs to `claimed`. This is the normal state for a draft round, so it must look intentional rather than broken.
- `claimed == null` → all nine empty, with the lever name still legible.
- `verified > claimed` cannot happen (a verifier downgrades, never upgrades) but must not throw — clamp and render.
- The numeric label reads `"—"` when `claimed` is null, otherwise `claimed`, with the verified value beside it when they differ.

- [ ] **Step 1: Write the failing tests**

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AirBar from "../components/AirBar.jsx";

describe("AirBar", () => {
  it("renders nine segments", () => {
    const { container } = render(<AirBar name="Architecture" claimed={4} verified={3} />);
    expect(container.querySelectorAll("[data-air-seg]")).toHaveLength(9);
  });

  it("marks verified segments solid and the claimed remainder as ghost", () => {
    const { container } = render(<AirBar name="Architecture" claimed={5} verified={3} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "verified")).toHaveLength(3);
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(2);
    expect(segs.filter((s) => s.dataset.airSeg === "empty")).toHaveLength(4);
  });

  it("shows a draft lever as all-ghost rather than empty", () => {
    const { container } = render(<AirBar name="Architecture" claimed={4} verified={null} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "verified")).toHaveLength(0);
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(4);
  });

  it("renders an unanswered lever without throwing and shows a dash", () => {
    render(<AirBar name="Supply Chain" claimed={null} verified={null} />);
    expect(screen.getByText("Supply Chain")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("clamps a verified level above claimed instead of rendering negative segments", () => {
    const { container } = render(<AirBar name="X" claimed={2} verified={5} />);
    const segs = [...container.querySelectorAll("[data-air-seg]")];
    expect(segs.filter((s) => s.dataset.airSeg === "claimed")).toHaveLength(0);
    expect(segs).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run them and watch every one fail** — `cd frontend && npx vitest run src/pages/founder/__tests__/AirBar.test.jsx`. Expected: module-not-found.

- [ ] **Step 3: Implement `AirBar.jsx`**, presentational only, using the `data-air-seg` attribute the tests key on.

- [ ] **Step 4: Run the tests — all pass.**

- [ ] **Step 5: Mutation-check.** Change the segment classifier so ghost segments count from 0 instead of `verified`, and confirm the second test fails. Restore. Report what you broke.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/AirBar.jsx frontend/src/pages/founder/__tests__/AirBar.test.jsx
git commit -m "feat(vip): AirBar — 1-9 lever bar with verified/claimed split"
```

---

### Task 3: `LeverPanel` — questions, criteria, and the ladder

**Files:**
- Create: `frontend/src/pages/founder/components/LeverPanel.jsx`
- Test: `frontend/src/pages/founder/__tests__/LeverPanel.test.jsx`

**Interfaces:**
- Consumes: one element of `bundle.levers`, plus `bundle.catalog.questions[lever]`.
- Produces: `<LeverPanel lever={leverState} questions={questions} disabled onAnswer={(qId, optionId) => …} onToggleCriterion={(text) => …} />`

**Behaviour:**

1. **Three questions**, each a radio group over `question.options`. Option label is `option.text`; the value is `option.id`. Render `question.focus` as supporting copy. Selected value comes from `lever.q1_option` / `q2_option` / `q3_option`.
2. **Criteria checklist** from `lever.criteria` (already narrowed by the backend to the claimed level — do not filter again). Checked state from `lever.criteria_checked`, an array of strings.
3. **The level chip and the ladder explanation.** `lever.claimed_level` is authoritative — never recompute the score in the frontend, it is the backend's job and duplicating it invites drift. But you *must* explain it:
   - No answers at all → "Not started".
   - All three questions at their top option → "AIR {n} — fully evidenced."
   - Otherwise → name the capping question: "AIR {n} — lifted by {Qk}. {Q(k+1)} will count once {Qk} is at its top option."

   Derive the capping question by walking q1→q2→q3 and finding the first one whose selected option is not the maximum-level option in that question's own option list. That mirrors `lever_level`'s stopping condition without reimplementing its arithmetic.
4. **`disabled`** disables every input and hides the ladder hint (there is nothing left to act on).

- [ ] **Step 1: Write the failing tests**

Build a fixture with a two-question-maxed / third-unmaxed shape so the ladder message is exercised for real:

```jsx
const QUESTIONS = [
  { id: "q1", text: "Q1 text", focus: "F1", options: [
    { id: "A", level: 1, text: "q1 low" }, { id: "B", level: 2, text: "q1 top" }] },
  { id: "q2", text: "Q2 text", focus: "F2", options: [
    { id: "A", level: 2, text: "q2 low" }, { id: "B", level: 3, text: "q2 top" }] },
  { id: "q3", text: "Q3 text", focus: "F3", options: [
    { id: "A", level: 3, text: "q3 low" }, { id: "B", level: 4, text: "q3 top" }] },
];
const lever = (over = {}) => ({
  lever: "architecture", name: "Architecture & System Definition", family: "technology",
  q1_option: null, q2_option: null, q3_option: null, criteria_checked: [],
  claimed_level: null, verified_level: null, criteria: [], evidence: [], ...over,
});
```

Tests to write:
- Renders all three questions and every option's text.
- Selecting an option calls `onAnswer("q2", "B")` with those exact arguments.
- **Ladder:** with `q1_option: "A"` (not top) and `claimed_level: 1`, the panel names Q1 as the cap and says Q2 will count once Q1 is at its top option.
- **Ladder:** with `q1_option: "B"`, `q2_option: "A"`, `claimed_level: 2`, the cap named is Q2, not Q1.
- **Fully evidenced:** all three at top → the "fully evidenced" copy, and no "will count once" text anywhere.
- **Not started:** no answers → "Not started", and no ladder sentence.
- Criteria render from `lever.criteria`; a criterion present in `criteria_checked` is checked; clicking calls `onToggleCriterion` with the criterion string.
- `disabled` → every radio and checkbox is disabled and the ladder hint is absent.
- **Catalog-driven proof:** rename a question's text in the fixture and assert the new text appears — nothing about the framework is baked into the component.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement `LeverPanel.jsx`.**

- [ ] **Step 4: Run — all pass.**

- [ ] **Step 5: Mutation-check the ladder tests specifically.** Change the cap-finder to always return q1 and confirm the "cap is Q2" test fails. Then change it to ignore the top-option check entirely and confirm the "fully evidenced" test fails. Restore both. These two are the tests most likely to pass for the wrong reason — report exactly what you broke and what failed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/LeverPanel.jsx frontend/src/pages/founder/__tests__/LeverPanel.test.jsx
git commit -m "feat(vip): LeverPanel with ladder-aware level explanation"
```

---

### Task 4: `EvidenceRow` — the qualifying document per lever

**Files:**
- Create: `frontend/src/pages/founder/components/EvidenceRow.jsx`

**Interfaces:**
- Consumes: one `bundle.levers` element.
- Produces: `<EvidenceRow lever={leverState} disabled onUpload={(file) => …} onDelete={(id) => …} onDownload={(id) => …} />`

**Behaviour:**
- Header: the lever name and `lever.required_document` — the document the framework demands at the claimed level.
- `lever.required_document == null` (no level claimed yet) → an empty state saying the document is named once the lever's questions are answered. **Do not render a file input in this state**; the backend 422s `no_document_required`, so offering the control invites a guaranteed error.
- Existing rows from `lever.evidence`: filename, size, uploaded date, a download action and a delete action.
- Uploading when a row already exists is a **replace** — say so on the button, because the backend replaces on conflict and a founder who expects to accumulate copies will be surprised.
- Download calls `onDownload`, which fetches a signed URL and opens it. **Download stays enabled when `disabled` is true** — a founder must be able to retrieve their own documents after submitting. Upload and delete are the actions that lock.
- **Optional backfill (spec §4.3).** The required document is the one at the claimed level, but every *lower* level's document may also be supplied. Render those beneath the required one, collapsed by default, clearly marked optional, each with its own upload. Source them from `bundle.catalog.documents[lever]` — the entries whose level is below `lever.claimed_level`. `onUpload` therefore takes the level: `onUpload(airLevel, file)`.
  - Skip a level the catalog defines no document for; `required_document` falls back to the highest defined level at or below the claimed one, so gaps in the ladder are normal and must not render an empty row.
  - Existing evidence rows carry `air_level`; file each under its own level rather than listing them all against the required one.

- [ ] **Step 1: Write the failing tests** covering: the null-`required_document` empty state renders no file input; an existing row shows its filename and a working download; the upload control reads as "Replace" when a row exists; `disabled` locks upload and delete but leaves download enabled; the optional-backfill list offers exactly the catalog's below-claimed levels and no row for a level the catalog leaves undefined; `onUpload` receives the level it was invoked from, proved by uploading against a backfill level rather than the required one.

- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check** the disabled-download test by locking download too, and confirm it fails.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/founder/components/EvidenceRow.jsx frontend/src/pages/founder/__tests__/EvidenceRow.test.jsx
git commit -m "feat(vip): EvidenceRow — per-lever qualifying document"
```

---

### Task 5: `FounderTlr` — the five-step wizard

**Files:**
- Rewrite: `frontend/src/pages/founder/FounderTlr.jsx`
- Test: `frontend/src/pages/founder/__tests__/FounderTlr.test.jsx`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: the route component already wired at `/founder/tlr` by Phase 1. Do not touch routing.

**Steps** (spec §4.4, these exact labels):

```
01 Overview    02 Technology    03 Commercial    04 Evidence    05 Scorecard
```

- `eyebrow` reads `AIR evaluation · {round.round_label}`.
- **01 Overview** — teaching copy: what AIR is, the six levers, the two families, how gates work. Static prose, but the six lever names come from `bundle.catalog.levers`.
- **02 Technology** — a `LeverPanel` for each lever with `family === "technology"`. Filter from the catalog; do not hardcode the three keys.
- **03 Commercial** — the same for `family === "commercial"`.
- **04 Evidence** — an `EvidenceRow` per lever, all six.
- **05 Scorecard** — an `AirBar` per lever grouped by family, the Technology / Commercial / Overall rollups from `bundle.rollups.claimed`, and the submit gate.

**Autosave.** `onAnswer` and `onToggleCriterion` update local state optimistically, then `PUT /founder/air/levers/{lever}` with the **whole** lever payload (`q1_option`, `q2_option`, `q3_option`, `criteria_checked`) — the endpoint writes all four columns on every call, so sending a partial patch would blank the others. Replace local state with the response bundle when it returns, so `claimed_level`, `criteria` and `required_document` re-derive server-side.

**The submit gate.** Submit is offered only when every lever has a `claimed_level`. When it is not, list which levers are outstanding by name — an unexplained disabled button is the single most common complaint about the TIR wizard. After a successful submit the round is `submitted`: the whole wizard becomes read-only and step 05 shows the frozen scorecard.

- [ ] **Step 1: Write the failing tests.** Mock `founderApi.getAir` with a full six-lever bundle fixture. Cover:
  - The stepper renders all five labels and the round label in the eyebrow.
  - Step 02 shows exactly the three technology levers, step 03 exactly the three commercial ones.
  - Answering a question calls `putAirLever` with the lever key and **all four** payload fields.
  - The response bundle replaces state: a `claimed_level` changed by the server shows on screen without a refetch.
  - Step 05 renders six `AirBar`s and the three rollups.
  - Submit is disabled with an incomplete bundle **and the outstanding lever is named**.
  - Submit is enabled when all six have levels; clicking calls `submitAir`.
  - A `submitted` bundle renders every input disabled and offers no submit.
  - A failing `putAirLever` surfaces the error banner without discarding the founder's other answers.

- [ ] **Step 2: Run and watch fail. Step 3: Implement. Step 4: Run — pass.**

- [ ] **Step 5: Mutation-check** the "all four payload fields" test by dropping `criteria_checked` from the payload, and the "submitted is read-only" test by ignoring the status. Confirm each fails. Report both.

- [ ] **Step 6: Full frontend suite**

```bash
cd frontend && npx vitest run
```
Every test green, including the pre-existing founder tests. `FounderVipTabs.test.jsx` asserts the placeholder — **update it**, do not delete it.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/founder/FounderTlr.jsx frontend/src/pages/founder/__tests__/
git commit -m "feat(vip): AIR evaluation wizard (5 steps)"
```

---

## Out of scope

- The MIS forms (Phase 5), the dashboard (Phase 6), the admin verification queue (Phase 7).
- Any backend change.
- Reaching prior rounds' evidence — deliberately deferred to the admin phase (spec §4.5).
- Verified levels will be null on every lever for every venture until Phase 7 builds the surface that writes them. The wizard must render that state gracefully; it must not wait for it.
