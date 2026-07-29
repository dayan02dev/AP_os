# IISc Jury Roster (Admin Portal, Jury Mode) — Design Spec

**Date:** 2026-07-29
**Branch:** `release/sip-launch-v1` (real prod) — work in worktree `.claude/worktrees/release-sip-launch-v1`
**Ships as:** **frontend-only** → user promotes on Vercel. No migration, no new backend endpoints. SAM deploy only if the build introduces a backend change (none expected in this design).

**Goal:** Add an "IISc Jury Roster" section to the admin portal's Jury Decision mode: browse all 809 scraped IISc professors, open a detail view per professor, see which jury-selected applications match each professor's expertise (domain-wise recommendation), and send jury-invite emails to chosen professors. Also hide the Applications and Rejected-Applications tabs in Jury mode.

**Architecture:** A new admin screen `AdminIiscRoster.jsx` reads a static `public/iisc_professors.json` (the 809-row roster), renders a design-system `os-table` with filters and a detail drawer, computes recommendations client-side by matching each professor's `matched_domains` tokens against jury-selected applications' ARTPARK-domain tokens, and reuses the existing `adminPlatformApi.createJuryInvites` flow for invites. Tab visibility becomes decision-mode-aware in `AdminTabBar`.

**Tech stack:** React + Vite (static public asset, `fetch` at runtime), existing `useAdminData` hooks, existing `adminPlatformApi.createJuryInvites`, design-system `os-*` classes + purple accent `#3213b7`.

---

## 1. Tab visibility (jury mode) — `AdminPortal.jsx`

`AdminTabBar` (`frontend/src/pages/admin/platform/AdminPortal.jsx:253-290`) currently builds one shared tab list rendered identically in both modes. Make it decision-mode-aware:

- **Reviewer mode:** unchanged — `Dashboard · Reviewers · Applications · Rejected Applications · Jury Selected · Admin Review`.
- **Jury mode:** `Dashboard · IISc Jury Roster · Jury · Jury Selected · Final Gate` — i.e. **hide** `pipeline` (Applications) and `rejected` (Rejected Applications), and **insert** a new `iisc_roster` tab at position 2 (after Dashboard, before the `reviewers`/"Jury" tab).

Implementation: build the tabs array, then when `decisionMode === 'jury'` filter out `{pipeline, rejected}` and splice in `{ id:'iisc_roster', label:'IISc Jury Roster', sub:'CANDIDATE POOL' }` after `dashboard`. New page render in `AdminApp` (line ~395 area): `{page === 'iisc_roster' && decisionMode === 'jury' && <AdminIiscRoster go={setPage} />}`. If the mode flips to reviewer while on `iisc_roster`, fall back to `dashboard` (guard in the render + a `useEffect` that resets page when the current tab isn't valid for the mode).

## 2. Roster data — `public/iisc_professors.json`

Copy `scratchpad/iisc_combined_all.json` (809 rows) to `frontend/public/iisc_professors.json`. Each row already has: `name, title, department, division, profile_url, research_domain, subdomains, notable_work, artpark_match ("Yes"|"Partial"|"No"), matched_domains (";"-joined tokens or "—"), reasoning, duplicate_joint_appointment ("Yes"|"")`. The screen `fetch("/iisc_professors.json")` once on mount (lazy — file only loads when the tab is opened), holds it in state. ~460 KB, admin-only, browser-cached; not bundled into the main JS.

## 3. Roster screen — `AdminIiscRoster.jsx` (new)

New file `frontend/src/pages/admin/platform/screens/AdminIiscRoster.jsx`. Strict design system: `PageHead` (eyebrow "A-7 · IISC JURY ROSTER", title "IISc jury <em>roster</em>"), an optional `← Dashboard` button (`go` prop, like AdminJury), a filter bar, and an `os-table`.

**Filter bar** (same control classes as AdminJury): `os-input` search (name/research/notable-work); `os-select` division; `os-select` department; `os-select` match (Yes/Partial/No); `os-select` ARTPARK domain (the 13 tokens with human labels); a "Unique only" checkbox that hides `duplicate_joint_appointment === "Yes"` rows (default OFF → all 809 shown).

**Columns:** Name (`nm` link style, opens detail) + title small; Department chip + division subtext; ARTPARK match chip (`os-chip` Yes→purple/`green`-replacement, Partial→amber, No→neutral — reuse the design-system tones, no bespoke colors, zero green); Matched domains (`dtag` chips); **Recommended apps** (count, click-through opens detail scrolled to the list); Invite (`os-btn` — see §6). Sortable headers (name/department/match/recommended-count), client-side, mirroring AdminJury's `RosterTable` sort pattern.

Empty/loading/error states via the existing `LoadingState`/`ErrorState` atoms.

## 4. Per-professor detail — drawer

Clicking a row opens a right-side drawer (same `os-drawer` markup/animation as `ManageJurorsDrawer.jsx`): header = name + title · department · division; body sections — Research domain; Subdomains (chips); **Notable work**; ARTPARK match chip + Matched domains (chips) + Reasoning; a prominent **"View profile ↗"** anchor (`profile_url`, `target="_blank" rel="noopener"`); and **Recommended jury-selected applications** (the list from §5, each showing project name, industry, AI score, and matched domain). Footer: an **Invite** button (§6) + Close. No new data fetch inside the drawer — the professor object + the jury-selected apps list are passed in as props.

## 5. Recommendation logic (client-side, domain-wise)

**Source of jury-selected apps:** `useAdminData("pipeline")` (the roster screen already needs admin data), filtered client-side to `chip === "JURY REVIEW"` (i.e. status `jury_review`) — identical to how `AdminJury`/`ApplicationsTable` isolates jury rows. Each app row carries `domain` (industry **label**) and `ai.overall`, `name`, `track`, `founders`.

**Label → token map:** a constant `LABEL_TO_TOKEN` covering the 13 ARTPARK domains, keyed by the **real** `industry_categories.label` strings (confirm exact prod labels during implementation — e.g. comms is "Communication (Wired & Wireless)"), mapping to tokens `{ai, robotics, health, defense, ev_mobility_services, industry, semi, comms, climate_fintech, edtech, dev_tools, e_commerce_crafts, other}`. Also keep the inverse `TOKEN_TO_LABEL` for the domain filter dropdown. Unmapped labels → skipped (logged once), never crash.

**Match:** for jury-selected app `a`, `aToken = LABEL_TO_TOKEN[a.domain]`. For professor `P` with `pTokens = matched_domains split on ";"` (excluding `"—"`), `recommendedApps(P) = jurySelected.filter(a => aToken && pTokens.includes(aToken))`. Every jury-selected app therefore appears under **every** professor whose expertise covers its domain (Yes and Partial professors both qualify — any non-empty `matched_domains` intersection). Professors with match "No" (`matched_domains === "—"`) get an empty list. The table's "Recommended apps" count and the drawer's list both use this.

**Perf:** precompute `appsByToken: Map<token, app[]>` once from the jury-selected list; each professor's recommendations = union of `appsByToken` over its tokens (deduped by app id+track). O(profs × tokens), trivial for 809 × ≤13.

## 6. Invite button (reuse existing flow)

Per-professor **Invite** (`os-btn secondary sm`) in the table row and the detail footer. Clicking opens a small modal (same `os-modal` pattern as `AdminJury`'s `JuryInviteModal`, but single-row): **Name** prefilled from the professor (read-only or editable), **Email** input (admin types/confirms), **Send invite** → `adminPlatformApi.createJuryInvites([{ name, email }])`. On success show the returned per-row status chip (invited / already_invited / error), exactly as the existing invite modal does. This creates a `jury_invites` row + sends the existing tokenized jury-invite email + provisions the auto juror account — no new backend.

**Already-invited marking:** the screen also loads `useAdminData("jurors")` (jurors + pendingInvites) and marks any roster professor whose `name` matches (normalized: lowercase, trim, collapse spaces/dots) an existing juror or pending invite with an **"Invited"** chip, disabling the Invite button for them. Best-effort (names are admin-entered on invite); the authoritative invite state remains the existing **Jury** tab. Because the roster has no email, matching is by name only — documented as approximate.

## 7. Error handling

- `iisc_professors.json` fetch failure → `ErrorState` with retry; the tab never white-screens.
- Missing/`"—"` `matched_domains` → professor simply has zero recommendations.
- Unmapped industry label → that app is skipped from matching (logged once), roster still renders.
- Invite failure → per-row error chip + message, no crash (mirrors existing modal).

## 8. Testing (vitest/RTL)

- `AdminIiscRoster.test.jsx`: renders rows from a mocked fetch; a domain filter narrows the list; the "Recommended apps" count for a professor equals the number of jury-selected apps in its domain (mock pipeline); clicking Invite → modal → Send calls `createJuryInvites([{name, email}])`; a professor whose name matches an existing juror shows "Invited" and a disabled button; "Unique only" hides joint rows.
- `AdminPortal` tab test: in jury mode the tab list excludes Applications + Rejected and includes "IISc Jury Roster" at position 2; in reviewer mode it's unchanged.
- Note: the repo has ~2 pre-existing `AdminPipeline` failures unrelated to this work.

## 9. Deployment

- **Frontend-only.** No migration, no backend endpoint, no SAM deploy required — the invite endpoint (`POST /admin/platform/jury/invites`) is already live in prod. Ship = commit on `release/sip-launch-v1`, push, **user promotes on Vercel**.
- If implementation reveals a genuine backend need (e.g. exposing the industry token on the pipeline row instead of the client-side label map), run `infra/sam/deploy-prod.sh` from the worktree after verifying `TIR_/SIP_SUBMISSIONS_CLOSED=true`. Otherwise SAM deploy is a no-op and is skipped.

## Out of scope

- No DB table / seed for the roster (static JSON by decision).
- No live scraping of papers/citations in the detail view (scraped fields + profile link only).
- No email scraping/storage (admin enters email at invite time).
- No changes to the existing Jury tab / jury-assignment / picks flows.
- No change to reviewer-mode tabs.
