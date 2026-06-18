# ARTPARK OS — Jury Dashboard · Build Handoff for Claude

> **Read this fully before writing any code.** You are continuing the **Jury Dashboard**,
> which must stay visually + architecturally *coherent* with the already-shipped
> **Admin Portal** and **Reviewer module** (ARTPARK OS family: Reviewer → Admin → Jury →
> Leadership). Do **not** invent a new design language — reuse the one documented here.

---

## 0. Where things live (IMPORTANT — read first)

- **This jury project:** `C:\artpark-jury\artpark-jury\` ← you work HERE.
  (The outer `C:\artpark-jury\` is just the unzip wrapper — it also has `__MACOSX/` and
  `.DS_Store` macOS junk you can ignore. The real project is the nested `artpark-jury\`.)
- **Design reference (already built):** `C:\ARTPARK-admin\` — the Admin Portal. When
  unsure how a header/table/card/decision should look or behave, open its
  `os/admin-1.jsx` / `os/admin-2.jsx` / `os/styles.css` and mirror it.
- The jury project was **cloned from the Reviewer module**, so it already has the shell,
  topbar (with the logo), styling, and a backend-ready **API seam**. Your job is to
  evolve it into a full jury console and align it to the Admin design rules in §7.

### This project's current structure
```
C:\artpark-jury\artpark-jury\
  jury.html             entry (loads data.js, api.js, shell.jsx, reviewer.jsx); ?v= cache-bust
  os/
    styles.css          design system (same token family + os-/lp- classes as Admin)
    data.js             window.OS_DATA seed (STARTUPS, REVIEWERS, JURY, …)
    api.js              ← the API seam: the ONLY place the UI talks to "the backend"
    shell.jsx           shared atoms (Topbar, PageHead, ScoreBar, Slider, Chip, Stat…)
    reviewer.jsx        ← MAIN component file (cloned name). Holds JuryApp, JuryTopbar,
                          and the page components. Renders <JuryApp/> at the bottom.
  assets/
    artpark-iisc-combined.webp   ← the combined ARTPARK + IISc logo lockup (USE THIS)
    artpark-logo.png             ARTPARK wordmark alone
    iisc-logo.png                IISc mark alone
```
> Note the main file is still named `reviewer.jsx` from the clone — components inside are
> already renamed `Jury*`. You may keep the filename (just bump `?v=` in `jury.html` on
> every edit) or rename to `jury.jsx` and update the `<script>` tag.

### Run / preview locally
```bash
cd C:\artpark-jury\artpark-jury
python -m http.server 5500 --bind 127.0.0.1
# open http://127.0.0.1:5500/jury.html
```
A `file://` open will NOT work (browser blocks the babel fetches). Always serve over HTTP.

### Validate JSX without a build
```bash
npx --yes esbuild os/reviewer.jsx --outfile=NUL    # Windows; /dev/null on macOS/Linux
```
Do not pass `--loader=jsx` (the extension auto-detects; the flag errors).

---

## 1. Tech stack & golden rules (NON-NEGOTIABLE)

**Babel-in-browser React. There is NO build step.** No Vite/Webpack/npm/imports/TypeScript.

- React 18.3.1 + ReactDOM + @babel/standalone, all from CDN `<script>` tags.
- Component files load as `<script type="text/babel" src="os/X.jsx?v=NN">`. The `?v=NN`
  is **manual cache-busting** — bump it in `jury.html` on every edit (currently `v=21`).
- **No ES modules.** Share across files via `Object.assign(window, {...})`.
- Mount once at the end of `reviewer.jsx`:
  `ReactDOM.createRoot(document.getElementById('root')).render(<JuryApp/>)`.
- Destructure hooks per file with a unique alias to avoid cross-file redeclaration
  (e.g. `const { useState: useRS } = React;`).

---

## 2. LOGO & branding (the topbar lockup) — do this exactly

The header uses the **combined ARTPARK + IISc lockup as a single image on a white
background** (per brand guidelines — one image, no hand-built divider). It is **already
wired** in `JuryTopbar` (in `reviewer.jsx`). Keep this pattern; don't replace it with
text or separate marks.

**Markup (already present — keep it):**
```jsx
<div className="lp-brand">
  <img className="lp-brand-combined"
       src="assets/artpark-iisc-combined.webp"
       alt="ARTPARK · AI & Robotics Technology Park @ IISc" />
</div>
```

**CSS (in `os/styles.css`):**
```css
.lp-brand          { display:flex; align-items:center; gap:9px; flex:0 0 auto; }
.lp-brand-combined { height:54px; width:auto; display:block;
                     background:#fff; border-radius:2px; padding:2px 4px; }
```

**Rules for the logo:**
- **Always the combined lockup** `assets/artpark-iisc-combined.webp` in the topbar.
  `artpark-logo.png` / `iisc-logo.png` are fallbacks/spares — don't use them in the
  header unless explicitly asked.
- Always on a **white background** (the `.webp` is designed for white; never place it on
  artblue or a dark bar). Keep height ~52–54px so it reads as the leadership/admin
  topbar does.
- The topbar itself is the **`lp-topbar`** bar (white, ~60px). Order of items:
  `← HOME` button · **logo lockup** · centered role pill (`lp-topbar-pill` →
  `JURY · <SECTION>` with a `lp-live-dot`) · right side user/role menu.
- The user chip uses an **initials monogram avatar** (`.os-avatar`, artblue bg, white
  text) — **never an emoji or photo** (see §7.4).
- If you ever need a favicon/title: `<title>ARTPARK OS — Jury Portal</title>` (already set).

> The Admin Portal uses the identical `lp-brand-combined` lockup — that's the whole point.
> The jury topbar should be indistinguishable in brand treatment from the admin one.

---

## 3. Data & the API seam (this project's backbone)

Unlike the Admin Portal (which mutates `window.OS_DATA` directly), this jury project
inherited the Reviewer module's **API client seam** at `os/api.js`. **Respect it:**

- `os/api.js` is *"the ONLY place the UI talks to the backend."* Every method returns a
  **Promise** and resolves mock data (from `window.OS_DATA` + a localStorage-backed
  store). To go live, a backend dev swaps each method body for a real `fetch()` — the
  **signatures and data shapes stay identical**, so no component changes.
- Components read data through the seam (e.g. `API.getMe()`, `API.getQueue()`,
  `API.getEvalScreen(idx)`, `API.saveEvaluation(appId, draft)`,
  `API.submitEvaluation(appId, body)`, `API.getHistory()`, `API.signOut()`), typically
  via a small `useAsync(() => API.x(), [deps])` hook.
- Persistence is localStorage-backed inside the seam (keys like
  `artpark.reviewer.evaluations.v3`). **When you add jury-specific persistence, add a
  new API method + a new LS key** (e.g. `artpark.jury.votes.v1`) rather than scattering
  `localStorage` calls through components. This keeps the backend handoff clean.
- Documented data shapes (JSDoc typedefs at the top of `api.js`) — extend these for jury:
  - `Reviewer` (here = juror): `{ id, name, email, initials, cohort, domains[] }`
  - `QueueItem`: `{ id, applicationId, name, founders[], domain, industry, stage, track, due, ai, reviewStatus }`
  - `Evaluation`: `{ appId, status, scores{problem,solution,tech,founders,commit}, recommendation:'yes'|'maybe'|'no', notes, flags[], updatedAt, submittedAt }`
- **`window.OS_DATA`** (in `data.js`) still holds the seed arrays: `STARTUPS`,
  `REVIEWERS`, `JURY` (`[{id,name,org}]` — Anand Mahindra/M&M, Kiran Mazumdar-Shaw/Biocon,
  Nandan Nilekani/Infosys, Falguni Nayar/Nykaa), `ACTIVITY`.

> **Golden rule for this project:** new data access goes through `api.js`. Don't bypass
> the seam — it's the feature the backend team will plug into.

---

## 4. Design tokens (single source of truth — already in `os/styles.css`)

Use the CSS variables; don't hardcode hexes (except the soft decision tints in §7.3,
which the existing classes already inline — match them exactly).

**Brand (primary):** `--artblue #3213b7` (leads everything), `--artblue-deep #1f0a8a`
(hover/depth), `--artlight #aafcf0` (mint, sparse), `--artblack #242424`, `--artwhite #efefef`.
**Secondary (status/data only):** `--brand-green #2F6F62` (approve/yes),
`--brand-amber #FFB703` (waitlist/maybe), `--brand-coral #FF5A5F` (reject/no, live-dot),
`--brand-violet #6B5CFF` (secondary series / "lead juror" accent).
**Neutrals:** `--bg/--paper #ffffff`, `--bg-soft #f6f6f8`, `--ink #242424`,
`--ink-soft #4a4a52`, `--ink-dim #8a8a92`, `--line #e3e3e8`, `--line-strong #c8c8d0`,
`--accent = artblue`, `--accent-soft #d8d0f3`.

**Typography:** `--font-serif`/`--font-display` = **Trebuchet MS** (headings + big stat
numbers, weight 400–700, tight tracking). `--font-sans`/`--font-body` = **Open Sans**
(body, buttons, most labels). `--font-mono` maps to **Open Sans** and is used for
**uppercase letter-spaced micro-labels/eyebrows** (~10px, 0.12–0.18em, `--ink-dim`) —
it is NOT real monospace. Real mono (`--font-code`) is for IDs only.

**Shape:** sharp radii — `--radius 2px` for chrome, `10–12px` only on `rv-`/`ps-` cards,
pills `999px`. Body 14px / line-height 1.5.

---

## 5. Components you already have & should reuse

**Shared atoms in `shell.jsx`** (global `window.*`): `Topbar`, `Sidebar`, `PageHead`,
`ScoreBar`, `Slider` (draggable — use for juror scoring), `Chip` (tones green/amber/red/
blue/violet/slate, auto dot), `Stat`, `Histogram`, `Radar`, `FlagDot`. (Do **not** use
`Variance` — §7.2.)

**Jury/console CSS already in `styles.css`** — build markup against these, don't rewrite:
- `.os-live-dot` / `.live-pulse` — pulsing coral LIVE dot.
- `.os-grid-juryconsole` — 3-col console grid `280px 1fr 320px` (responsive built-in).
- LEFT pitch rail: `.os-pitch-rail`, `.os-pitch-row` (+ `.done/.live/.upcoming`).
- CENTER stage: `.os-pitch-stage`, `.os-pitch-deck-frame` (16:9), `.slide-stats`,
  `.os-notes-prefilled`.
- RIGHT scoring: `.os-smallslider` (compact range rows; category color variants).
- Voting/deliberation: `.os-reco-group` + `.os-reco-btn.yes/.maybe/.no`, `.os-vote-bar`
  + `.seg.yes/.maybe/.no`, `.os-checkbox`, `.os-deliberation` table, `.os-deliberation-summary`.
- Per-juror score cards: `.rv-grid`/`.rv-card` (+`.is-primary` violet lead),
  `.rv-overall`, `.rv-scores/.rv-score`, `.rv-note`, `.rv-flags`.
- Shared chrome: `.lp-topbar*`, `.lp-tabs/.lp-tab`, `.lp-page-header/.lp-cohort-title`,
  `.gate-kpi*` (Trebuchet KPI tiles), `.os-table`, `.os-btn`, `.lp-filter-*` (collapsible
  filters), `.os-chip`, `.os-banner`.

---

## 6. App-shell & page set (mirror Admin's `AdminApp`)

`reviewer.jsx` already renders `<JuryApp/>` with `JuryTopbar`. Structure the views like
Admin: **Topbar → cohort header (`lp-page-header` → `lp-cohort-title`, year in artblue
italic) → tab bar (`lp-tabs`) → page content (`lp-tab-content`)**, switching on a `page`
state. Suggested jury views:

1. **Overview / Dashboard** — KPI tiles (to-judge / pitched / scored / decided), pitch-day
   schedule, juror roster (avatars + org from `OS_DATA.JURY`), recent activity.
2. **Live Pitch Console** (centerpiece) — `os-grid-juryconsole`: left pitch-order rail,
   center pitch stage + live notes, right scoring (`os-smallslider`) + vote
   (`os-reco-group`). `os-jury-clock` countdown with `os-live-dot` up top.
3. **Deliberation** — `os-deliberation` table: each shortlisted startup with every
   juror's vote (`os-vote-bar`), consensus, selectable rows, summary footer vs cohort cap.
4. **Final Decisions** — per-startup decision cards (reuse `rv-card` for per-juror
   breakdown), soft decision chips, rationale textarea, working **Export**.

The startups that reach the jury are the Admin-shortlisted ones
(`adminDecision === 'APPROVED'`); jury scores/reco live on `s.jury` (`{potential, fit,
defensibility, reco}`) — but route reads/writes through `api.js` (§3).

---

## 7. HARD RULES & lessons learned (the Admin build paid for these — honor them)

These came from direct stakeholder/manager feedback. Violating them gets work rejected.

1. **NO "AI Score" / AI baseline anywhere in the UI.** Removed by directive — decisions
   are **human-consensus only**. The data still carries an `ai` object; just never show
   it. ⚠️ This jury project was cloned from the Reviewer module, which **still surfaces
   AI scores/`ai.*` and an "AI summary" card** — you must **strip those** to match Admin.
2. **NO "variance" / "disagreement with AI"** anywhere. Don't render `<Variance>` or any Δ pill.
3. **Decision/vote colors must be SUBTLE** — soft tints + colored border/dot, never
   saturated fills:
   - Approve/Yes → bg `#eef5f1`, border `#bcd7cd`/`#2F6F62`, text `#2F6F62`
   - Waitlist/Maybe → bg `#fff8e6`, border `#f6d98a`/`#9a6206`, text `#9a6206`
   - Reject/No → bg `#fff0f0`, border `#f8c2c4`/`#d23b40`, text `#d23b40`
   ⚠️ This project's `styles.css` currently has the **LOUD** version (`.os-reco-btn.maybe.active{background:var(--brand-amber)}`, `.no.active{background:var(--brand-coral);color:#fff}`)
   and solid `.os-vote-bar` segments — **change these to the soft tints above** (copy the
   `.os-reco-btn`/`.os-chip` rules from `C:\ARTPARK-admin\os\styles.css`). For live
   tallies, keep the **number neutral `--ink`** and put brand color only on a small 6px
   **dot** next to the label. (Admin iterated 4× to land here — start here.)
4. **No emojis as UI.** Use **initials-monogram avatars** (`.os-avatar`; lead juror =
   violet bg, others = `--accent-soft`/artblue). The topbar user chip already does this.
5. **Everything must work live & persist** — through the **API seam** (§3). Scores, votes,
   and final decisions survive reload; Export actually downloads a file (mirror Admin's
   `downloadApplicationsCSV`). This is a production handoff.
6. **Brand colors are the minimal palette.** No new hues. ARTBlue leads; green/amber/coral
   only for status; violet only for secondary/lead.
7. **Plain, human naming.** (Admin renamed "Gate 1" → "Admin Review".) Use labels like
   "Live Pitches", "Scoring", "Deliberation", "Final Decisions".
8. **Match fonts/weights exactly.** Big numbers = Trebuchet. Labels = uppercase
   letter-spaced Open Sans, `--ink-dim`. Real mono for IDs only.

---

## 8. Acceptance checklist (self-review before declaring done)

- [ ] Loads via `python -m http.server` at `/jury.html` with no console errors.
- [ ] Indistinguishable from the Admin Portal in brand treatment (topbar, header, tabs, cards, fonts).
- [ ] **Combined ARTPARK + IISc lockup** (`lp-brand-combined` → `artpark-iisc-combined.webp`) in the topbar, on white, ~54px.
- [ ] **Zero** AI score / AI summary / variance anywhere (stripped from the reviewer clone).
- [ ] Decision/vote colors are the soft tints in §7.3 (not the loud cloned ones); live counts = neutral number + small colored dot.
- [ ] Avatars are initials monograms; no emojis.
- [ ] Scores/votes/decisions persist across reload **via `api.js`**; Export downloads.
- [ ] Trebuchet for big numbers/headings; uppercase letter-spaced Open Sans for labels; sharp 2px radii.
- [ ] `esbuild` validates each edited `.jsx`; `?v=` bumped in `jury.html`.

---

## 9. Copy-these-patterns reference

| You want to… | Open & mirror |
|---|---|
| Topbar + logo lockup | `reviewer.jsx` → `JuryTopbar` (already correct — keep it) |
| App shell / tabs / page switch | `C:\ARTPARK-admin\os\admin-2.jsx` → `AdminApp`/`AdminTabBar` |
| Backend-ready data access | this project's `os/api.js` (extend it; don't bypass) |
| Soft decision colors / chips | `C:\ARTPARK-admin\os\styles.css` → `.os-reco-btn`, `.os-chip` |
| Apply + persist a decision | Admin `applyGateDecision` → here, do it as an `api.js` method |
| Client-side CSV export | Admin `downloadApplicationsCSV` |
| Per-person score cards | Admin `rv-grid`/`rv-card` block |
| Initials avatar | Admin `revInitials`/`ReviewerAvatar` |
| Live console styling | this project's `styles.css` "JURY CONSOLE" section |

> Golden principle: **when in doubt, do exactly what the Admin Portal does** — coherence
> across the ARTPARK OS portals is the entire goal of this dashboard.
