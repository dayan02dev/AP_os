# ARTPARK Design System — Implementation Brief

> This file is a documentation reference. It is NOT auto-loaded by Claude Code.
> Saved here on 2026-05-18 as the canonical brief for admin / leadership / shared UI work.
> Originally pasted as a CLAUDE.md candidate; we chose docs/ instead so per-session work
> doesn't pull the whole brief into every conversation.

---

## 0. Mission

You are working inside the **ARTPARK Programs** monorepo (the Vercel app at `ap-os-git-staging-rolebaseddashboard-artpark.vercel.app`). The marketing site (`apply.artpark.info`) and applicant flow (`apply.artpark.info/apply`) already use the ARTPARK design system. The **admin** (`/admin/*`), **leadership** (`/leadership`), and **shared** (`/apply/profile`, `/apply/signin`, `/apply/support`) surfaces currently do **not** — they look generated, generic, and inconsistent.

**The job: rebuild every admin / leadership / shared screen so it is visually indistinguishable, in vocabulary, from the marketing and applicant flows.** Treat the design system below as a contract. If a screen needs a pattern that isn't documented here, derive it from the documented primitives — **do not invent new tokens, new corner radii, new shadows, or new color accents.**

The product is IISc-affiliated. The visual feel is **professional, calm, type-first, flat, sharp-cornered, near-monochrome with one purple accent.** It is *not* a startup landing page. It is *not* a generic SaaS admin template. Resist every reflex toward gradients, glassmorphism, rounded-2xl cards, lift-on-hover, candy-colored badges, emoji, lucide icons everywhere, drop shadows, or pastel category fills. None of those exist in ARTPARK.

---

## 1. Ground rules (read these every time)

These are the rules most likely to be silently broken. Re-read before each screen.

1. **Sharp corners.** `border-radius: 2px` is canonical. The only exception is `border-radius: 999px` for status dots (8×8) and the support FAB (44×44). No `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full` on anything that isn't a dot or the FAB.
2. **No drop shadows on cards, modals, or panels.** The system is flat. The only shadow allowed: focus ring `0 0 0 3px rgba(50,19,183,0.15)` on inputs and the support FAB's `0 2px 8px rgba(36,36,36,0.18)`.
3. **No gradients.** Anywhere. The hero has a desaturated photo, not a gradient. Backgrounds are solid `--paper`, `--paper-soft`, `--artblue`, `--accent-violet`, or `--artblack`.
4. **No emoji. No lucide icons by default.** The brand is type-first. If you genuinely need an icon for an admin action (edit, delete, filter, sort), substitute **Lucide at 1.5px stroke, sized to match adjacent line-height, colored `var(--ink-soft)`.** Flag it in a code comment: `/* TODO: lucide is a placeholder — ARTPARK has no icon set */`. Never use emoji, never use heroicons, never use phosphor, never use react-icons grab-bags.
5. **One arrow glyph: `→`.** Inside primary CTAs, in a `<span class="arrow">→</span>`. `←` is used for "Back". `✓` is used for "SAVED ✓" and success states. That's the full glyph set.
6. **Two emphasis vehicles, used sparingly.** `.hl` (mint-cyan background `--artlight`, text `--artblue`) for the *promise* in a headline. `.em` (purple, underlined, 3px thickness, 6px offset) for naming a *person or thing*. **At most one of each per headline. Most headlines have neither — let the size do the work.**
7. **Headlines end with a period.** "Users." "Applications." "Change status." This is canonical — it gives the calm, declarative cadence. Buttons do not end in periods.
8. **No exclamation marks. Ever.**
9. **Em-dashes are normal.** "A short, honest conversation — not a form." Use them in subheads and helper copy.
10. **Second person.** "Pick a reviewer to assign." Never "Let's assign a reviewer!"
11. **Casing.** Page titles: sentence case ("Add user", "Change status", "Assign reviewer"). Eyebrows/labels/section numbers: `UPPERCASE` with `letter-spacing: 0.14em`. Buttons: sentence case ("Save changes", "Send invite →"). Proper noun programs only get title case ("Technology Innovator in Residence").
12. **No hover lift, no hover scale, no hover translate.** Buttons transition `background`/`border-color`/`color` over 150ms ease. Primary buttons darken from `--artblue` to `--artblue-deep`. Links stay underlined.
13. **One container width: `--container-w: 1180px`** with `--gutter: 24px`. Use it everywhere. Admin tables and the leadership dashboard live inside the same container.
14. **Generous whitespace.** Major section vertical rhythm is 96px (`--s-9`) on marketing. Admin can tighten to 48–64px (`--s-7`/`--s-8`) but never feel cramped.
15. **Backgrounds.** White (`--paper`) is the dominant surface. `--paper-soft` (`#f6f6f8`) is a *visual breath*, used for alternating table rows, empty-state panels, and the soft variant of cards — not as a slab to color a whole section.
16. **The semantic accents (`--accent-coral`, `--accent-amber`, `--accent-green`, `--accent-violet`) are semantic, not decorative.** Coral = error/destructive/closed. Amber = warning. Green = success/open/saved. Violet = info/SIP/secondary purple. **Never reach for them to color a category, a chip, or a chart bar just because you ran out of `--artblue`.** Charts use shades of `--artblue` (see §6.5).

---

## 2. Design tokens — single source of truth

Every CSS file in admin / leadership / shared screens **must** consume these custom properties from `colors_and_type.css`. Do not redeclare them. Do not hard-code their hex values inline. Do not import a second token file.

The full token table is in `frontend/src/styles/colors_and_type.css`. **45 tokens total:**

`--accent-amber`, `--accent-coral`, `--accent-green`, `--accent-violet`, `--artblack`, `--artblue`, `--artblue-deep`, `--artlight`, `--artwhite`, `--container-w`, `--font-body`, `--font-display`, `--font-mono`, `--gutter`, `--ink`, `--ink-dim`, `--ink-soft`, `--lh-body`, `--lh-snug`, `--lh-tight`, `--line`, `--line-strong`, `--paper`, `--paper-soft`, `--r-pill`, `--r-sharp`, `--s-1` through `--s-10`, `--t-body`, `--t-body-lg`, `--t-body-sm`, `--t-display`, `--t-eyebrow`, `--t-h1`, `--t-h2`, `--t-h3`, `--t-h4`.

**If you need a value that isn't here, stop.** Re-read §1. The answer is almost always "use what's already there" — for example, an admin "tertiary" text shade is `--ink-dim`, not a new `--ink-faintest`. A "card hover" border is `--ink`, not a new `--line-stronger`.

---

## 3. Typography

```
Display (headings, buttons, eyebrows):
  Trebuchet MS, Lucida Grande, Tahoma, sans-serif
  font-weight: 700 (or 600 for buttons)
  letter-spacing: -0.01em on headings; 0.04em on small caps labels; 0.14em on eyebrows.

Body / inputs:
  Open Sans (Google Fonts), then system stack.
  font-weight: 400 normal, 600 emphasized, 700 strong.
  Base: 16px / line-height 1.55.

Mono: there is no mono. Use Open Sans for "monospace-feeling" things (SAVED ✓, the q-numbers in the wizard) and rely on uppercase + letter-spacing for the effect.
```

**Heading sizes in admin / leadership context (smaller than marketing):**

| Slot | Size | LH | Use |
|---|---|---|---|
| Page title (`h1`) | 36px | 1.18 | "Users.", "Applications.", "Add user.", user's name on detail. |
| Section title (`h2`) | 28px | 1.25 | "Personal info", "Roles", "Security", "Status funnel". |
| Card / panel title (`h3`) | 22px | 1.25 | Modal headers, drawer headers, metric-card labels. |
| Small label (`h4`) | 16px uppercase 0.14em tracking | 1.25 | Repeated table-section labels. |

Don't use `--t-h1` (72px) or `--t-display` (96px) anywhere in admin / leadership. Those belong to marketing.

**Eyebrows.** Above every page title and every major section. `UPPERCASE`, `0.14em` tracking, `var(--t-eyebrow)` (11px), `var(--ink-dim)`, weight 600. Prefix optional 56px × 2px purple rule (`.eyebrow-rule`).

```html
<span class="eyebrow eyebrow-rule">User management</span>
<h1>Users.</h1>
```

---

## 4. Component primitives — use these exactly

See `frontend/src/styles/colors_and_type.css` and `frontend/src/styles/admin.css` for the full implementation. Key classes:

- **Buttons**: `.btn.btn-primary` (purple), `.btn.btn-dark` (black), `.btn.btn-ghost` (transparent), `.btn.btn-destructive` (coral). Use `<span class="arrow">→</span>` for the CTA arrow.
- **Inputs**: `.field` (boxy, dense) for admin/modals/drawers. `.apply-input` (underlined large) only for sign-in and support subject.
- **Cards**: `.card`, `.card.card-soft`, `.card.card-purple`, `.card.card-violet`, `.card.card-black`. No box-shadow ever. Internal padding `var(--s-6)` default, drop to `var(--s-5)` for dense admin metrics.
- **Status dots**: `.dot`, `.dot.green`, `.dot.amber`, `.dot.coral`, `.dot.blue`, `.dot.dim`. 8×8 only. The one round element besides FAB and avatar circles.
- **Eyebrow**: `.eyebrow` / `.eyebrow-rule`. Always above page titles and major section headings.
- **Emphasis**: `.hl` (mint highlight) and `.em` (underlined purple). At most one of each per headline. Most headlines have neither.

---

## 5. Patterns — see admin.css for the §5.1–§5.12 primitives

The base patterns are implemented in `frontend/src/styles/admin.css`:

- §5.1 `.app-shell` / `.app-header` / `.app-rail` / `.app-main` — three-bar shell with optional left rail
- §5.2 `.page-head` — eyebrow + h1 + sub + actions
- §5.3 `.tbl` — admin/list tables with sortable headers, hover rows, primary cells
- §5.4 `.filter-bar` + `.chip` — search + role/track chips above tables
- §5.5 `.modal-scrim` + `.modal` — centered card on tinted scrim
- §5.6 `.drawer-scrim` + `.drawer` — right-side detail panel
- §5.7 `.tabs` — underlined tab strip
- §5.8 `.metrics` + `.metric` — KPI strip with `.is-feature` (purple) and `.is-highlight` (mint-cyan) variants
- §5.9 `.bar-row` + `.funnel` + `.histogram` — hand-rolled charts, no chart library
- §5.10 `.def` — definition list for personal info
- §5.11 `.toast` — single-line notification with semantic left rule
- §5.12 `.saved` — `SAVED ✓` indicator

**Leadership-specific extensions** live in `admin.css` under §5.13–§5.15:

- §5.13 Leadership header (HOME / logos / role-pill / user / APPLICANT / SIGN OUT) and cohort hero
- §5.14 Funnel container card with right-side two-line labels and `↓` separator
- §5.15 Status grid 5×2 with semantic dots, page footer

---

## 6. Page-by-page spec

For each route in scope, build the screen using **only** the primitives above. Don't introduce new components.

(Full page-by-page spec lives in the original brief — see git log for `docs/design-system.md` if you need the full text. The summary:)

- `/admin/users` — list with filter bar, role chips, ellipsis-menu row actions
- `/admin/users/new` — single-column form with segmented role picker
- `/admin/users/:id` — two-col layout (personal info + activity + security)
- `/leadership` Dashboard — 5-card metric strip + funnel + histogram + score components + industry bars + status grid
- `/leadership` Applications — filter bar + table + drawer
- `/apply/profile` — centered card stack (personal · password · sessions · danger zone)
- `/apply/signin` — already follows the system; don't redesign
- `/apply/support` — centered form with category picker

---

## 7. Anti-patterns (catch these in your own diff before submitting)

| Grep | Why it's wrong |
|---|---|
| `rounded-(md\|lg\|xl\|2xl\|3xl\|full)` (where target isn't dot/FAB) | Sharp corners only. Use `rounded-[2px]` or `border-radius: var(--r-sharp)`. |
| `shadow-(sm\|md\|lg\|xl\|2xl)` or `box-shadow` (where target isn't focus ring) | The system is flat. Strip it. |
| `bg-gradient`, `linear-gradient`, `radial-gradient` | No gradients anywhere. |
| `hover:scale-`, `hover:translate-`, `transition.*transform` on buttons | No motion on hover other than color. |
| `backdrop-filter`, `backdrop-blur` | No glass. |
| Emoji, `from 'lucide-react'` without placeholder comment | Type-first brand. |
| `#3213b7`, `#aafcf0`, `#FF5A5F`, etc. as literals (outside colors_and_type.css) | Always `var(--…)`. |
| `font-family.*Inter\|Roboto\|system-ui` directly | Use `var(--font-display)` or `var(--font-body)`. |
| `<h1>.*</h1>` without trailing `.` | Headlines end with periods. |
| `!` at the end of a headline / button label | No exclamation marks. |
| `Let's `, `let's `, `we'll get you` | Wrong voice. Use "you". |

---

## 8. Self-check before you finish

- [ ] Every screen renders with `font-family: var(--font-display)` for headings and `var(--font-body)` for body.
- [ ] Every color value in my diff is either `var(--…)` or `#fff` / `rgba(50,19,183,0.15)` (focus ring) / `rgba(36,36,36,0.55)` (scrim).
- [ ] Every `border-radius` is `2px`, `999px`, or `50%` (avatar circle / dot / FAB).
- [ ] No `box-shadow` except the focus ring and the support FAB.
- [ ] No gradients, no backdrop-filter.
- [ ] Every `h1` / `h2` ends with a period.
- [ ] Every page has an eyebrow above the `h1`.
- [ ] Primary buttons have `<span class="arrow">→</span>`. Their hover state changes color, not size or shadow.
- [ ] Tables use `--paper` rows + `--paper-soft` thead background.
- [ ] Modals scrim is `rgba(36,36,36,0.55)`. Modal itself has no shadow.
- [ ] Status uses dots, not pill-shaped colored badges.
- [ ] No icon other than `→`, `←`, `✓`, the support `?` glyph, the `+`/`−` for pros/cons, status dots, or — last resort — Lucide-with-the-placeholder-comment.
- [ ] No emoji.
- [ ] Layout container is 1180px max-width with 24px gutters.

---

## 9. Documented deviations from the brief

The leadership dashboard (`/leadership`) intentionally deviates from §5.9 on chart fills:

- **Histogram bars**: brief says `--artblue` fill + `--artblack` median; the leadership prototype (which the screenshots match) uses `--artblack` fill + `--artblue` median. We followed the prototype.
- **Score component bars**: brief says `--artblue` fill; prototype uses `--artblack`. We followed the prototype.
- **Funnel and industry bars** still use `--artblue` / `--artblue-deep` per the brief.

Rationale: the screenshots produced from the original prototype are the user's explicit visual reference. Reasoning: in this dashboard, purple is reserved for primary pipeline metrics (funnel/industry) and black for finer-grained scoring breakdowns. Documented here so future contributors don't "fix" the inversion.

---

## 10. When you're unsure

Ask. Don't invent. The brand is small, deliberate, and easy to violate by guessing. A short clarifying question is always cheaper than a generic admin template that has to be redone.
