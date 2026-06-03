# ARTPARK Reviewer Module — Functional / Backend Handoff

**Author:** UI/UX engineering
**Status of code:** Pixel-complete, design-coherent prototype. **Zero backend wiring.**
**Goal of this doc:** Tell backend/full-stack devs exactly what is mocked, what state must persist, which API endpoints are needed, and what to fix to make this a working product — without redesigning the UI.

---

## ⚑ UPDATE — the frontend is now prepped for plug-in (`os/api.js`)

The UI no longer reads `window.OS_DATA` directly. Every screen now goes through a
single **API client seam**: `os/api.js` → `window.ReviewerAPI`. Each method is a
`Promise` returning the shapes in §2; today they resolve mock data + a
`localStorage`-backed evaluation store. **To go live, swap each method body for a
real `fetch()` — no component changes needed.**

What is already wired (so you only fill in the network layer):
- `getMe`, `getQueue`, `getEvalScreen(idx)`, `getEvaluation`, `saveEvaluation`,
  `submitEvaluation`, `getHistory` — all called via a `useAsync` hook with real
  **loading / error / empty** states rendered in every list.
- **Evaluation is controlled + per-application + persisted.** Scores, recommendation,
  notes, per-dimension disagreement reasons, and flags are all captured, isolated
  per app (form remounts on `appId`), **autosaved (debounced 800 ms)**, and reload
  on open. "Save draft" and "Submit" call the seam; queue status + dashboard counts
  update live off saved/submitted records.
- **Dead buttons wired:** Home, Sign out (stubs → `window.toast`/`signOut()`), Save
  draft, Submit, rubric Download (generates `scoring.md`), Export CSV.
- **Fixed in passing:** the two-data-models conflict (queue is now one canonical
  record in `api.js`), the VIP rows mislabelled `· TIR`, and the uncontrolled
  Notes/disagreement inputs (§4.2, §4.3, §4.7).

Still open for backend (unchanged from below): real auth/session, real per-application
**content** (§2.3 — `getEvalScreen` still serves the shared `APP_DETAIL` essay),
server-computed weighted overall (§4.4), server-driven edit window (§4.5),
server-side required-field validation (§4.6), routing, and the build pipeline (§1).

Demo knobs: `ReviewerAPI.latencyMs` (default 200 — set 0 to disable simulated
latency) and `ReviewerAPI._resetEvaluations()` (re-seed the local store).

---

## 0. TL;DR — the 6 things that make this "a mockup"

1. **All data is hardcoded** in `os/data.js` (16 startups) + inline constants. No fetch/API/localStorage anywhere in the codebase.
2. **The application content the reviewer scores is fake and identical for every startup** — `APP_DETAIL` ("Evaldam AI") in `reviewer.jsx` is shown for all 8 queue items. The thing a reviewer is supposed to read does not change.
3. **Evaluation state is local and ephemeral** — scores, recommendation, notes, flags, disagreements live in component `useState`, initialise to the *same hardcoded values for every application*, and are lost on refresh, tab-switch, or prev/next navigation. Nothing is saved.
4. **Key actions are dead buttons** — Home, Sign out, Save draft, Submit (sets a local boolean only), Download rubric, the cohort/user dropdown carets.
5. **No build pipeline / no auth / no routing** — React + Babel are loaded from a CDN and JSX is compiled in the browser at runtime; there is no bundler, no login, no URL state.
6. **Two data models disagree** — the queue table and the evaluation screen show *different* industry/stage/track for the same startup (see §4.2).

The visual layer is in good shape and matches the Leadership design system. The work below is almost entirely **state + data + integration**, not styling.

---

## 1. Architecture: what must change to be production-grade

| Area | Today | Needs to become |
| --- | --- | --- |
| Build | `index.html` loads `react.development.js`, `react-dom`, `@babel/standalone` from unpkg; `.jsx` compiled in-browser | Real bundler (Vite/Next). Pre-compile JSX, tree-shake, minify, use React **production** build. Remove Babel-standalone. |
| Module system | Components attached to `window` (`Object.assign(window, {...})`); load order matters | ES modules / imports. Kill the global namespace. |
| Cache busting | Hardcoded `?v=19` query strings in `index.html` | Content-hashed asset filenames from the bundler. |
| Data | `window.OS_DATA` global object | API client layer (fetch/React Query/RTK Query) with loading/error/empty states. |
| State | Local `useState` only | Server state (queue, application, AI scores) + persisted evaluation drafts (see §3). |
| Routing | `tab` is `useState`; refresh resets to "queue" | Real router (`/reviewer/queue`, `/reviewer/eval/:appId`, `/reviewer/history`). Deep-linkable, back-button works. |
| Auth | None. Hardcoded "Vikram Sundar / vikram@artpark.in" | Reviewer identity from auth/session. Drives "my queue", "my history", permissions, audit trail. |
| Env | Single static `index.html` | API base URL, feature flags via env. |

---

## 2. The data contract (what backend must expose)

Proposed REST shapes. Field names mirror the current mock so wiring is mechanical.

### 2.1 `GET /api/reviewer/me`
Reviewer identity for the header + scoping.
```json
{ "id": "r1", "name": "Vikram Sundar", "email": "vikram@artpark.in",
  "initials": "VS", "domains": ["Robotics","Mobility"], "cohort": "TIR + VIP 2026" }
```

### 2.2 `GET /api/reviewer/queue`
The assigned applications (drives the **My Queue** table **and** the **Dashboard** — today both call one `buildReviewerQueue()`; keep that single-source contract).
```json
[{
  "id": "s01",
  "applicationId": "TIR-00001",
  "name": "Karkhana Robotics",
  "founders": ["Aanya Mehta","Rohit Kapoor"],
  "industry": "Robotics & Automation",     // ONE canonical industry (see §4.2)
  "stage": "Pilot-ready",
  "track": "tir",                           // "tir" | "vip"
  "due": "2026-05-22T00:00:00Z",            // real date, not "1d" string
  "ai": { "overall": 8.4, "conf": 92, "problem": 8.6, "solution": 8.2,
          "tech": 9.0, "founders": 7.8, "commit": 8.4 },
  "reviewStatus": "submitted"               // submitted | in-progress | draft | not-started
}]
```
> `reviewStatus` must come from the reviewer's own evaluation record, **not** be hardcoded by array index as it is today (`i < 1`, `i === 1`, `i === 2`).

### 2.3 `GET /api/applications/:id`
**The most important missing piece.** The full application the reviewer reads. Today this is the static `APP_DETAIL` object shown for everyone. Backend must return per-application content: AI summary, the structured Q&A (`SECTIONS` in `FullApplicationView`), uploaded pitch-deck/demo links, declarations.
```json
{
  "id": "s01", "applicationId": "TIR-00001", "name": "Karkhana Robotics",
  "aiSummary": "…per-application AI summary…",
  "sections": [
    { "num":"01", "title":"Basic details",
      "questions":[ {"prompt":"…","help":"…","required":true,"answer":"…","type":"text|choice|file"} ] }
  ],
  "fields": [
    { "label":"Problem defined", "value":"Yes", "short":true },
    { "label":"Problem description", "bullets":["one sentence…","one sentence…"] }
  ],
  "attachments": [ {"kind":"deck","name":"pitch.pdf","url":"…","pages":14,"sizeMB":6.2} ]
}
```

> **⚑ AI-content format is UI-enforced (reviewer feedback).** The reviewer's
> evaluation panel renders every long AI field as **short, one-sentence bullet
> points** — never a paragraph dump (see `fieldBullets()` / `isFactField()` in
> `os/reviewer.jsx`). Whatever the backend sends, the UI keeps the same look:
> - **Preferred:** send `"bullets": string[]` — each ≤ 1 sentence. Used as-is.
> - Send a `"value"` paragraph → the UI **auto-splits it into sentence bullets**
>   (handles decimals, ₹ amounts, `•` markers). Resilient, but the AI emitting real
>   bullets is cleaner, so **make the AI prompt produce one-sentence bullets.**
> - Short facts (e.g. "Problem defined: Yes", "Solution stage") → mark `"short":true`
>   (or keep them brief) to render as compact tiles instead of bullets.
>
> Net effect: **any application added later automatically follows the same
> formatted, bulleted UI/UX** — no per-application styling needed. The `aiSummary`
> stays a short overview paragraph in the branded card. Labels use proper English
> ("Problem description", "Solution description").

### 2.4 `GET /api/reviewer/evaluations/:appId`  ·  `PUT` (autosave draft)  ·  `POST` (submit)
The reviewer's working evaluation. Drives prefill on open, autosave of "Save draft", and "Submit evaluation".
```json
{
  "appId": "s01", "reviewerId": "r1", "status": "draft",   // draft | submitted
  "scores": { "problem":7.0, "solution":7.5, "tech":8.0, "founders":6.5, "commit":7.0 },
  "overall": 7.2,                          // server can recompute (weighted, see §4.4)
  "recommendation": "yes",                 // yes | maybe | no
  "notes": "…",
  "disagreements": { "founders": "sole founder, execution risk" },
  "flags": ["Single founder — execution risk"],
  "editWindowExpiresAt": "2026-05-28T15:58:00Z",  // drives the countdown (see §4.5)
  "updatedAt": "…", "submittedAt": null
}
```
- `PUT` = save draft (also the target for **autosave**, see §3).
- `POST` = submit; server enforces validation (§4.6), locks the record after the edit window, writes audit log.

> **⚠ Data-model caveat — key evaluations by `reviewId`, not `appId`.**
> The same startup can be **assigned in the current cohort's queue** *and* have a
> **past-cohort review in My History** — these are two distinct evaluation records.
> The mock keys evaluations by `appId` and therefore keeps **two separate stores**
> (`STORE` = current queue, `HISTORY_STORE` = past reviews) so that editing a history
> item never mutates the queue, and vice-versa (see `os/api.js` → `storeFor(source)`,
> and the `source: 'queue' | 'history'` param on `getEvalScreen`/`saveEvaluation`/
> `submitEvaluation`). In production this is cleaner as a single table keyed by a
> **`reviewId`** (e.g. `cohortId + appId + reviewerId`); the UI's `source` param maps
> directly to "which review record". My History is then just a **view** of submitted
> review records, and My Queue a view of the current cohort's assignments.

> **Re-open / amend:** a submitted evaluation can be re-opened in the UI ("Re-open to
> edit" → edit → "Re-submit"). The server should gate this on authorization + the edit
> window and append an **audit entry** (who re-opened, when, what changed) rather than
> silently overwriting the prior submission.

### 2.5 `GET /api/reviewer/history`
Past evaluations + the cohort-wide consistency stats currently hardcoded (`34`, `92%`, `0.4`, `18m`).
```json
{ "stats": { "total": 34, "consistencyPct": 92, "avgVariance": 0.4, "avgMinutes": 18 },
  "rows": [ {"appId":"s01","name":"Karkhana Robotics","date":"2026-04-18",
             "myScore":7.9,"aiScore":8.4,"variance":0.5,"reco":"yes","adminDecision":"approved"} ] }
```
> History "Edit reco" currently mutates local state only and is never sent anywhere — decide whether editing a *submitted* historical reco is even allowed; if so it needs a `PATCH` + audit trail.

### 2.6 `GET /api/rubric` and `GET /api/rubric/export`
Rubric is hardcoded twice (`RubricModal` and `RubricInline`) — **deduplicate to one source** fed by the API, so "scoring.md v3.1" can change without a redeploy. The "Download" button (R-4) and modal must hit the same source.

### 2.7 `GET /api/reviewer/queue/export.csv`
Optional: the **Export CSV** button is currently client-side only (8 queued rows). Fine to keep client-side, but if exports must reflect server truth/filters or be audited, add a server endpoint.

---

## 3. State & persistence model (the core functional gap)

Today every evaluation field is `useState` with a **hardcoded initial value**, so:
- Opening application B shows application A's leftover scores/notes/flags.
- Prev/Next navigation does **not** load that application's evaluation.
- Refresh/clock-out loses all work.

Required behaviour:
1. **On open `/eval/:appId`** → `GET /applications/:id` (content) + `GET /evaluations/:appId` (prefill the reviewer's draft, or empty defaults if none).
2. **Autosave** scores/notes/flags/reco/disagreements on change (debounced ~1–2s) via `PUT`. Show the "Saved" indicator (the `.saved` style already exists). "Save draft" becomes an explicit flush.
3. **Submit** → `POST`, optimistic UI, then lock fields when `status==='submitted'` or edit window elapsed.
4. **Per-application isolation** — keep evaluations keyed by `appId`; don't reuse one component's state across applications (or remount on `appId` change).

---

## 4. Bugs & inconsistencies to fix (independent of backend)

**4.1 Dead controls (no handler):** `← HOME`, `SIGN OUT ↗`, **Save draft**, rubric **Download**, cohort dropdown caret, user dropdown caret. Submit only does `setSubmitted(true)`.

**4.2 Two conflicting data models for the same startup.**
- Queue/Dashboard use `buildReviewerQueue()` which **overrides** `domain`/`stage` with `QUEUE_ITEM_INDUSTRY` / `QUEUE_ITEM_STAGE` and assigns `track` by index (`i<5`).
- The evaluation screen uses **raw** `window.OS_DATA.STARTUPS[idx]`, so it shows the *original* `domain` ("Robotics"), `stage` ("Pre-seed"), and `trl`.
- Result: Karkhana shows "Robotics & Automation / Pilot-ready" in the table but "Robotics / Pre-seed / TRL 5" on the scoring screen. **Pick one canonical record** (the API record in §2.2) and use it everywhere.

**4.3 ID label is wrong for VIP rows.** Rows render `TIR-000xx · TIR` for *every* item, including VIP-track ones. Derive the prefix/label from `track`.

**4.4 "Overall" math doesn't match the stated weighting.** The reviewer "overall" is a plain mean of 5 sliders, but the dashboard advertises weighted signals (Problem 22 / Solution 30 / Tech 22 / Founders 14 / Commit 12). Decide: weighted everywhere, and compute server-side so AI vs reviewer variance is apples-to-apples.

**4.5 Countdown timer is fake.** `timeLeft` starts at 3240s on mount and resets on every remount; it gates Submit but is tied to nothing. Drive it from `editWindowExpiresAt` (server time), and reconcile clock skew.

**4.6 "Required" rules are not enforced.** Copy says *"Notes required for variance > 1.0"* and *"variance > 1.0 — required"*, but Submit is allowed with empty notes/empty reco. Enforce client-side (block + inline error using existing `.field-error`) **and** server-side.

**4.7 Uncontrolled inputs lose data.** The **Notes** textarea (`defaultValue=…`) and each **disagreement reason** `<input>` are uncontrolled with no state/handler — whatever the reviewer types is never read. Make them controlled and part of the evaluation payload.

**4.8 The "AI summary / Problem & solution / Full application" is the same Evaldam AI text for all startups.** (= §2.3). This is the single most misleading part of the demo for non-engineer stakeholders.

**4.9 Duplicated logic.** `reviewerStatus(s)` and the inline `getStatus(s)` in `ReviewerQueue` are identical — collapse to one. Rubric defined twice (§2.6).

**4.10 History stats are static** (`34 / 92% / 0.4 / 18m`) and unrelated to the 7 rows shown.

---

## 5. UX / accessibility polish (recommended before launch)

- **Custom `Slider` is mouse-only.** No keyboard support, no ARIA. Add `role="slider"`, `aria-valuenow/min/max`, arrow-key handling, focus ring. Same for the reco buttons (use `aria-pressed`).
- **Clickable table rows** (`<tr onClick>`) aren't keyboard-reachable. Add a focusable control or `role="button"` + key handlers, or make the project name a real link.
- **Modal (`RubricModal`)** has no focus trap, no `Esc`-to-close, no `aria-modal`. Backdrop click works.
- **Loading / empty / error states** don't exist — every list assumes data is present. Needs skeletons + "no applications assigned" + error retry.
- **Submit feedback** — no toast/confirmation; success is just a button label flip. Add confirmation + "what happens next".
- **`activeCat` state is set but never used** in `ReviewerEval` — wire it (e.g., scroll rubric to the active dimension) or remove.
- **No responsive treatment** for the 2-column evaluation grid on narrow screens (`grid-template-columns: 1fr 380px`).
- **Number formatting / i18n** — dates are display strings ("12 Apr 2026", "1d"); centralise once real dates arrive.

---

## 6. Dead code & cleanup

- **`os/reviewer.jsx_v=11`** — stale older copy (says "SIP" not "VIP"), not referenced by `index.html`. Delete.
- **Unused shared components** in `os/shell.jsx`: `Topbar`, `Sidebar`, `Stat`, `Histogram`, `Radar`, `FlagDot` are defined but never used by the reviewer portal. Remove or move to a shared lib if other modules need them.
- **`NAV_REVIEWER`** constant and **`screenshots/` + `uploads/`** folders are design-time artifacts not used at runtime — exclude from the app bundle.
- **`data.js`** carries `REVIEWERS`, `JURY`, `ACTIVITY`, `NOTIFICATIONS_FOUNDER` that the reviewer portal never reads — these belong to other modules; scope them out.

---

## 7. Suggested priority order

**P0 — make it real (blocking):**
- Build pipeline + remove CDN/Babel-standalone (§1)
- Auth + reviewer scoping (§1, 2.1)
- Per-application content API (§2.3, 4.8)
- Evaluation load/draft/submit + persistence (§2.4, §3)
- Fix the two-data-models conflict (§4.2)
- Enforce required-field validation (§4.6, 4.7)

**P1 — correctness & trust:**
- Real edit-window timer (§4.5), weighted overall (§4.4), routing (§1)
- History persistence + real stats (§2.5, 4.10)
- Wire dead buttons (§4.1), single rubric source (§2.6)
- Loading/empty/error states (§5)

**P2 — polish:**
- Accessibility (slider/modal/rows) (§5)
- Responsive evaluation layout, toasts, dead-code cleanup (§5, §6)

---

## 8. File map (where each concern lives)

| Concern | File · symbol |
| --- | --- |
| App shell, tab state, selected app | `os/reviewer.jsx` · `ReviewerApp` |
| Header (logo, role pill, user) | `os/reviewer.jsx` · `ReviewerTopbar` |
| Queue table + filters | `os/reviewer.jsx` · `ReviewerQueue`, `buildReviewerQueue`, `reviewerStatus` |
| Dashboard tiles/charts | `os/reviewer.jsx` · `ReviewerDashboard` |
| Evaluation (scores/reco/notes/flags) | `os/reviewer.jsx` · `ReviewerEval` |
| Full application content (STATIC) | `os/reviewer.jsx` · `APP_DETAIL`, `FullApplicationView` |
| Rubric (duplicated) | `os/reviewer.jsx` · `RubricModal`, `RubricInline` |
| History | `os/reviewer.jsx` · `ReviewerHistory` |
| CSV export | `os/reviewer.jsx` · `exportReviewerQueueCsv` |
| Mock data | `os/data.js` · `window.OS_DATA` |
| Shared atoms (some unused) | `os/shell.jsx` |
| Design tokens / theme | `os/styles.css` |
