# ARTPARK Design System — Implementation Brief

> **Status:** canonical. This is the source of truth for every admin, leadership, and shared (`/apply/profile`, `/apply/signin`, `/apply/support`) screen on `ap-os-git-staging-rolebaseddashboard-artpark.vercel.app`. Marketing (`apply.artpark.info`) and applicant flow (`/apply/...`) already follow this system; the admin / leadership / shared surfaces do not yet.
>
> If a screen needs a pattern that isn't documented here, derive it from the documented primitives — **do not invent new tokens, new corner radii, new shadows, or new color accents.**

---

## 0. Mission

You are working inside the **ARTPARK Programs** monorepo. The marketing site (`apply.artpark.info`) and applicant flow (`apply.artpark.info/apply`) already use the ARTPARK design system. The **admin** (`/admin/*`), **leadership** (`/leadership`), and **shared** (`/apply/profile`, `/apply/signin`, `/apply/support`) surfaces currently do **not** — they look generated, generic, and inconsistent.

**Job: rebuild every admin / leadership / shared screen so it is visually indistinguishable, in vocabulary, from the marketing and applicant flows.** Treat the design system below as a contract.

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

```css
:root {
  /* ---------- Brand color ---------- */
  --artblue:        #3213b7;  /* primary brand purple — buttons, links, emphasis */
  --artblue-deep:   #1f0a8a;  /* darker purple — hover, depth */
  --artlight:       #aafcf0;  /* mint cyan — text-highlight bg, stat numerals */
  --artblack:       #242424;  /* near-black */
  --artwhite:       #efefef;  /* off-white surface */

  /* ---------- Semantic accents ---------- */
  --accent-coral:   #FF5A5F;  /* cons / negative / destructive */
  --accent-amber:   #FFB703;  /* warnings */
  --accent-green:   #2F6F62;  /* pros / positive / saved */
  --accent-violet:  #6B5CFF;  /* SIP secondary purple / info */

  /* ---------- Ink (text) ---------- */
  --ink:            #242424;  /* primary text */
  --ink-soft:       #4a4a52;  /* secondary text */
  --ink-dim:        #8a8a92;  /* muted / eyebrow */

  /* ---------- Lines ---------- */
  --line:           #e3e3e8;  /* subtle dividers */
  --line-strong:    #c8c8d0;  /* stronger borders */

  /* ---------- Surfaces ---------- */
  --paper:          #ffffff;  /* page background */
  --paper-soft:     #f6f6f8;  /* section background, alt-row, soft cards */

  /* ---------- Type families ---------- */
  --font-display: "Trebuchet MS", "Lucida Grande", Tahoma, sans-serif;
  --font-body:    "Open Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono:    "Open Sans", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  /* ---------- Type scale ---------- */
  --t-eyebrow:    11px;
  --t-body-sm:    14px;
  --t-body:       16px;
  --t-body-lg:    18px;
  --t-h4:         22px;
  --t-h3:         28px;
  --t-h2:         44px;
  --t-h1:         72px;
  --t-display:    96px;

  --lh-tight:     1.08;
  --lh-snug:      1.25;
  --lh-body:      1.55;

  /* ---------- Radii ---------- */
  --r-sharp:      2px;
  --r-pill:       999px;

  /* ---------- Spacing scale ---------- */
  --s-1:  4px;
  --s-2:  8px;
  --s-3:  12px;
  --s-4:  16px;
  --s-5:  24px;
  --s-6:  32px;
  --s-7:  48px;
  --s-8:  64px;
  --s-9:  96px;
  --s-10: 128px;

  /* ---------- Layout ---------- */
  --container-w:  1180px;
  --gutter:       24px;
}
```

**Allowed `var(--*)` names — the full set, 45 tokens.** If you need a value that isn't here, stop. Re-read §1. The answer is almost always "use what's already there".

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

### 4.1 Buttons

```html
<a class="btn btn-primary">Invite reviewer <span class="arrow">→</span></a>
<a class="btn btn-dark">Confirm change <span class="arrow">→</span></a>
<a class="btn btn-ghost">Cancel</a>
```

- Padding `12px 22px`, Trebuchet 14/600, `letter-spacing: 0.01em`, `border-radius: 2px`.
- Primary: bg `--artblue`, white text → hover bg `--artblue-deep`.
- Dark: bg `--artblack`, white text → hover bg `#000`.
- Ghost: transparent, `--ink` text, `1px solid var(--line-strong)` → hover border `--ink`.
- Transition: 150ms ease on the listed properties. **No transform.**
- **Destructive button** = primary button with `background: var(--accent-coral)` and hover-darken to `#e94a4e`.

### 4.2 Inputs

Use `.field` for inputs in modals / drawers / dense forms:

```html
<label class="field-label">Email</label>
<input class="field" type="email" placeholder="name@artpark.in" />
```

Use `.apply-input` (the underlined large input from the applicant flow) **only** on the sign-in screen and the support form's "subject" field — it belongs to the applicant voice. Admin forms use boxy `.field` inputs because they're denser.

### 4.3 Cards

```html
<div class="card">…</div>            <!-- white, 1px line, 32px pad -->
<div class="card card-soft">…</div>   <!-- f6f6f8 bg, no border -->
<div class="card card-purple">…</div> <!-- --artblue, white text -->
<div class="card card-violet">…</div> <!-- --accent-violet, white text -->
<div class="card card-black">…</div>  <!-- --artblack, white text -->
```

Cards never have `box-shadow`. Internal padding defaults to `var(--s-6)` (32px) — drop to `var(--s-5)` (24px) for dense admin metric cards.

### 4.4 Status dots

```html
<span class="dot"></span>          <!-- violet, default/info -->
<span class="dot green"></span>    <!-- success/open/active -->
<span class="dot amber"></span>    <!-- warning/needs-review -->
<span class="dot coral"></span>    <!-- closed/error/deactivated -->
```

8×8 filled circle. **The only round element other than the FAB.** Never resize them above 12px.

### 4.5 Eyebrow + section header

```html
<span class="eyebrow">Applications</span>
<h2>Funnel.</h2>
```

### 4.6 Highlight + emphasis

```html
<h1>Good to see you, <span class="em">UDITA UNIYAL</span>.</h1>
<h2>From <span class="hl">53 applications</span> to <span class="hl">12 finalists</span>.</h2>
```

Use at most one of each per headline. Most admin/leadership headings have neither.

---

## 5. Patterns you must derive (not in the base system)

Copy these styles into a new file `admin.css` next to `applicant.css` / `marketing.css`, importing nothing besides `colors_and_type.css`.

### 5.1 App shell (admin / leadership / shared signed-in)

Three stacked bars + body. Same as `apply-shell`, with one addition: a **left rail** for admin/leadership nav.

```css
.app-shell {
  min-height: 100vh; background: var(--paper); color: var(--ink);
  font-family: var(--font-body);
  display: grid; grid-template-rows: auto auto 1fr;
}

.app-betabar {
  background: var(--artblack); color: #fff;
  padding: 8px 24px; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase;
  display: flex; align-items: center; gap: 12px;
}
.app-betabar .pill {
  background: var(--artlight); color: var(--artblack);
  padding: 3px 8px; border-radius: 2px; font-weight: 700; font-size: 11px;
}

.app-header {
  position: sticky; top: 0; z-index: 50;
  background: var(--paper); border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 24px; padding: 14px 24px;
}
.app-header .logos { display: flex; align-items: center; gap: 16px; }
.app-header .logos img.iisc { height: 36px; }
.app-header .logos .rule { width: 1px; height: 28px; background: var(--line-strong); }
.app-header .logos img.artpark { height: 28px; }
.app-header .role-tag {
  font-family: var(--font-body); font-weight: 600;
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-dim);
  padding-left: 16px; border-left: 1px solid var(--line); margin-left: 8px;
}
.app-header .spacer { flex: 1; }
.app-header .user-chip {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 6px 10px; border: 1px solid var(--line); border-radius: 2px;
  font-size: 13px; color: var(--ink);
}
.app-header .user-chip .avatar {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--artblue); color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-display); font-weight: 700; font-size: 11px;
}
```

**Header right-side order:** spacer · role tag (`ADMIN` or `LEADERSHIP`) · switch-role link · user chip with initials avatar.

**Left rail (admin + leadership only):**

```css
.app-body { display: grid; grid-template-columns: 240px 1fr; }
.app-rail {
  border-right: 1px solid var(--line); padding: 32px 0;
  background: var(--paper);
  position: sticky; top: 73px; align-self: start;
  height: calc(100vh - 73px); overflow-y: auto;
}
.app-rail .rail-section {
  padding: 0 24px; margin-bottom: 8px;
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-dim); font-weight: 600;
}
.app-rail a.rail-link {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 24px;
  font-family: var(--font-body); font-size: 14px; font-weight: 600;
  color: var(--ink); text-decoration: none;
  border-left: 3px solid transparent;
}
.app-rail a.rail-link:hover { background: var(--paper-soft); color: var(--artblue); }
.app-rail a.rail-link.active {
  background: var(--paper-soft);
  border-left-color: var(--artblue); color: var(--artblue);
}
.app-main { padding: 48px var(--gutter) 96px; max-width: 1180px; }
```

Admin rail: **User management** (Users, Add user). Leadership rail: **Programs** (Dashboard, Applications). Shared bottom of rail: **Support**, with a divider `1px solid var(--line)` above it.

### 5.2 Page header

```html
<header class="page-head">
  <div>
    <span class="eyebrow eyebrow-rule">User management</span>
    <h1>Users.</h1>
    <p class="page-sub">Search, filter by role, and drill into any user's profile.</p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="/admin/users/new">Invite user <span class="arrow">→</span></a>
  </div>
</header>
```

```css
.page-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 32px; margin-bottom: 32px;
}
.page-head h1 {
  font-family: var(--font-display); font-weight: 700;
  font-size: 36px; line-height: 1.18; letter-spacing: -0.01em;
  margin: 12px 0 0;
}
.page-sub {
  margin-top: 12px; max-width: 640px;
  color: var(--ink-soft); font-size: var(--t-body-lg); line-height: 1.55;
}
.page-actions { display: flex; gap: 12px; }
```

### 5.3 Tables

```css
.tbl {
  width: 100%; border-collapse: collapse;
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 2px; font-size: var(--t-body-sm);
}
.tbl thead th {
  text-align: left;
  font-family: var(--font-body);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  font-weight: 600; color: var(--ink-dim);
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--paper-soft);
}
.tbl tbody td {
  padding: 16px; border-bottom: 1px solid var(--line);
  color: var(--ink); vertical-align: middle;
}
.tbl tbody tr:last-child td { border-bottom: none; }
.tbl tbody tr:hover { background: var(--paper-soft); cursor: pointer; }
.tbl tbody tr.selected { background: rgba(50,19,183,0.04); }

.tbl th.sortable { cursor: pointer; }
.tbl th .sort-arrow { color: var(--ink-dim); margin-left: 4px; font-size: 10px; }
.tbl th[aria-sort="ascending"] .sort-arrow,
.tbl th[aria-sort="descending"] .sort-arrow { color: var(--artblue); }

.tbl td.num, .tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }
.tbl td.primary { font-weight: 600; }
.tbl td.primary .sub { display: block; color: var(--ink-soft); font-weight: 400; font-size: 12px; }
```

**Row actions** are an ellipsis menu at the far right, not a row of icon buttons.

**Empty state** — a `.card-soft` filling the table region, centered text.

### 5.4 Filter bar

```html
<div class="filter-bar">
  <input class="field filter-search" placeholder="Search by name or email" />
  <div class="filter-chips">
    <button class="chip active">All</button>
    <button class="chip">Reviewer</button>
    <button class="chip">Leadership</button>
    <button class="chip">Mentor</button>
    <button class="chip">Admin</button>
  </div>
</div>
```

```css
.filter-bar {
  display: flex; align-items: center; gap: 16px; padding: 16px;
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 2px; margin-bottom: 16px;
}
.filter-search { flex: 0 0 320px; }
.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  font-family: var(--font-display); font-weight: 600;
  font-size: 12px; letter-spacing: 0.04em;
  padding: 6px 12px; background: transparent;
  border: 1px solid var(--line-strong); border-radius: 2px;
  color: var(--ink-soft); cursor: pointer;
  transition: border-color 150ms ease, color 150ms ease, background 150ms ease;
}
.chip:hover { border-color: var(--ink); color: var(--ink); }
.chip.active { background: var(--ink); border-color: var(--ink); color: #fff; }
```

### 5.5 Modal

```css
.modal-scrim {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(36, 36, 36, 0.55);
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.modal {
  background: var(--paper); border-radius: 2px;
  width: 100%; max-width: 520px; padding: 32px;
  display: flex; flex-direction: column; gap: 20px;
}
.modal .modal-eyebrow {
  font-family: var(--font-body); font-size: 11px;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--artblue); font-weight: 600;
}
.modal h2 {
  font-family: var(--font-display); font-weight: 700;
  font-size: 28px; line-height: 1.18; margin: 0;
}
.modal .modal-body { color: var(--ink-soft); font-size: 15px; line-height: 1.6; }
.modal-actions {
  display: flex; justify-content: flex-end; gap: 12px;
  border-top: 1px solid var(--line); padding-top: 20px;
}
```

Scrim is `rgba(36,36,36,0.55)` — `--artblack` at 55%. Not pure black, not blue.

### 5.6 Drawer

```css
.drawer-scrim { position: fixed; inset: 0; z-index: 100; background: rgba(36,36,36,0.45); }
.drawer {
  position: fixed; right: 0; top: 0; bottom: 0;
  width: min(640px, 100vw);
  background: var(--paper); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; z-index: 101;
}
.drawer-head {
  padding: 24px 32px; border-bottom: 1px solid var(--line);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.drawer-head h2 {
  font-family: var(--font-display); font-weight: 700;
  font-size: 28px; line-height: 1.2; margin: 0;
}
.drawer-head .meta {
  font-size: 13px; color: var(--ink-soft);
  display: flex; gap: 12px; align-items: center; margin-top: 8px;
}
.drawer-close { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--ink-soft); }
.drawer-body { flex: 1; overflow-y: auto; padding: 24px 32px; }
.drawer-footer {
  padding: 16px 32px; border-top: 1px solid var(--line);
  display: flex; justify-content: flex-end; gap: 12px; background: var(--paper);
}
```

### 5.7 Tabs

```css
.tabs {
  display: flex; gap: 0; border-bottom: 1px solid var(--line);
  margin-bottom: 32px;
}
.tabs a {
  font-family: var(--font-display); font-weight: 700;
  font-size: 14px; letter-spacing: 0.04em;
  padding: 12px 20px;
  color: var(--ink-soft); text-decoration: none;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 150ms ease, border-color 150ms ease;
}
.tabs a:hover { color: var(--ink); }
.tabs a.active { color: var(--artblue); border-bottom-color: var(--artblue); }
```

### 5.8 Metric cards

```css
.metrics { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
.metric {
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 2px; padding: 24px;
  display: flex; flex-direction: column; gap: 8px;
}
.metric .label {
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-dim); font-weight: 600;
}
.metric .num {
  font-family: var(--font-display); font-weight: 700;
  font-size: 44px; line-height: 1; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.metric .delta { font-size: 13px; color: var(--ink-soft); }
.metric .delta.up   { color: var(--accent-green); }
.metric .delta.down { color: var(--accent-coral); }

.metric.is-feature { background: var(--artblue); color: #fff; border-color: transparent; }
.metric.is-feature .label, .metric.is-feature .delta { color: rgba(255,255,255,0.78); }
.metric.is-feature .num { color: #fff; }
```

**Exactly one** metric `is-feature` per row.

### 5.9 Charts

ARTPARK has no chart library. Hand-roll with HTML + CSS, **monochromatic in `--artblue`**, with `--paper-soft` as the empty/track color.

- **Funnel** → horizontal bars, height 36px, rectangular, `var(--artblue)`.
- **Histogram** → flex row of bars. All `--artblue`; highlight median with `--artblack`.
- **Score components** → horizontal stacked bars. `--artblue` fill, `--paper-soft` remainder. Tabular-nums right-aligned.
- **Industry bars** → same as components, sorted desc, top 5 + Other.
- **Status grid** → 6-column grid of `.metric` cards with status dots. **The one place semantic colors are legitimate.**

```css
.bar-row { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-bottom: 1px dashed var(--line); }
.bar-row:last-child { border-bottom: none; }
.bar-row .bar-label { flex: 0 0 200px; font-size: 14px; color: var(--ink); }
.bar-row .bar-track { flex: 1; height: 12px; background: var(--paper-soft); }
.bar-row .bar-fill  { height: 100%; background: var(--artblue); }
.bar-row .bar-value { flex: 0 0 64px; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-soft); font-size: 13px; }
```

**Do not** use chart.js, recharts, victory, nivo, or d3 unless explicitly asked.

### 5.10 Definition list

```html
<dl class="def">
  <div class="def-row"><dt>Full name</dt><dd>Udita Uniyal</dd></div>
  <div class="def-row"><dt>Email</dt><dd>udita@artpark.in</dd></div>
  <div class="def-row"><dt>Phone</dt><dd>+91 9XXX XXX XXX</dd></div>
  <div class="def-row"><dt>Joined</dt><dd>April 14, 2026</dd></div>
</dl>
```

```css
.def { margin: 0; padding: 0; }
.def-row {
  display: grid; grid-template-columns: 220px 1fr;
  padding: 14px 0; border-bottom: 1px solid var(--line);
}
.def-row:last-child { border-bottom: none; }
.def dt {
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-dim); font-weight: 600;
}
.def dd { margin: 0; color: var(--ink); font-size: 15px; }
```

### 5.11 Toast

```css
.toast {
  position: fixed; top: 88px; right: 24px; z-index: 200;
  background: var(--paper); border: 1px solid var(--line-strong);
  border-left: 3px solid var(--accent-green);
  padding: 14px 18px;
  display: flex; align-items: center; gap: 12px;
  font-size: 14px; color: var(--ink); max-width: 380px;
}
.toast.error   { border-left-color: var(--accent-coral); }
.toast.warning { border-left-color: var(--accent-amber); }
.toast.info    { border-left-color: var(--artblue); }
```

### 5.12 `SAVED ✓` indicator

```html
<span class="saved">SAVED ✓</span>
```

```css
.saved {
  font-family: var(--font-body);
  font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-green); font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
```

---

## 6. Page-by-page spec

### 6.1 `/admin` → `/admin/users` (server redirect, nothing to design)

### 6.2 `/admin/users`

App shell + left rail + page-head (eyebrow `USER MANAGEMENT` · h1 `Users.` · sub · primary action `Invite user →`). Filter bar with search + role chips. Table columns: **Name** (primary with email .sub), **Role**, **Status** (dot+label), **Last active**, ellipsis. Pagination: ghost prev/next + `--ink-dim` "Page 2 of 7" between.

### 6.3 `/admin/users/new`

Single-column form, max-width 560px. Eyebrow `INVITE USER` · h1 `Add a user.` · sub. Fields: Full name, Email, Role (segmented `.choice` from applicant flow), optional Welcome note. Actions: `Cancel` (ghost) + `Send invite →` (primary). Toast on success.

### 6.4 `/admin/users/:id`

Page head: eyebrow `USER · ADMIN`, h1 = user's name (no period), sub = email · role · dot · last-active. Two-column grid: `1fr 320px` `gap: 32px`. Left: three stacked `.card` panels — Personal info (def-list with inline edit), Roles (list with grant/revoke ghost buttons), Activity (last 5, dashed dividers). Right: single `.card-soft` Security panel with Reset password (ghost) + Deactivate (destructive primary). Reset and Deactivate open modals.

### 6.5 `/leadership` — Dashboard tab

Tabs (Dashboard / Applications). Page head: eyebrow `PROGRAMS · LEADERSHIP`, h1 `Funnel.`, sub. Right action: date range chip group (7d / 30d / 90d / All).

Layout top→bottom:
1. 5-card metric strip — first `is-feature` purple. Total apps / In review / Avg AI score / Reviewers assigned / Awaiting decision.
2. Two-column 60/40: **Funnel** (horizontal bars) + **Status grid** (6 cells with dots).
3. Two-column 60/40: **AI score histogram** + **Score components** (bar-rows).
4. Full-width: **Industry bars** sorted desc, top 5 + Other.

Section headers use `.eyebrow-rule` + h2 ending with period.

### 6.6 `/leadership` — Applications tab

Filter bar: search · status chips · program chips (TIR / SIP) · industry select · AI-score range (v2). Table columns: **Applicant** (primary with company .sub), **Program**, **Industry**, **AI score** (num), **Status** (dot+label), **Reviewer**, **Submitted**. Row click → drawer. Drawer body: applicant summary, Q/A as def-list, reviewer notes, AI breakdown. Footer: `Assign reviewer` (ghost) + `Change status` (primary).

### 6.7 `/apply/profile`

Shell without left rail. Centered max-width 640px. Eyebrow `PROFILE`, h1 `Your account.`, sub. Stacked `.card` sections: Personal · Password · Sessions · Danger zone. `SAVED ✓` top-right.

### 6.8 `/apply/signin`

**Already follows the system.** Don't redesign. Uses underlined `.apply-input`, four-quadrant Google button, `or` divider.

### 6.9 `/apply/support`

Centered max-width 560px. Eyebrow `SUPPORT`, h1 `How can we help?`, sub. Fields: Subject (`.apply-input` underlined), Category (segmented `.choice`s), Description (`.apply-textarea`), Optional attachment (`.upload-box`). Submit: `Send message →` (primary). FAB hidden on this page.

### 6.10 Reviewer surface — out of scope until Phase 1.5.

---

## 7. Anti-patterns (grep your diff)

| Grep | Why wrong |
|---|---|
| `rounded-(md\|lg\|xl\|2xl\|3xl\|full)` (non dot/FAB) | Sharp corners only. |
| `shadow-` or `box-shadow` (non focus-ring) | Flat system. |
| `bg-gradient`, `linear-gradient`, `radial-gradient` | No gradients. |
| `hover:scale-`, `hover:translate-`, `transition.*transform` on buttons | No motion. |
| `backdrop-filter`, `backdrop-blur` | No glass. |
| Emoji, `from 'lucide-react'` without placeholder comment | Type-first. |
| Hex literals (`#3213b7` etc.) outside `colors_and_type.css` | Always `var(--…)`. |
| `font-family.*Inter\|Roboto\|system-ui` directly | Use `var(--font-display)` / `var(--font-body)`. |
| Tailwind palette colors | ARTPARK tokens only. |
| `<h1>...</h1>` without trailing `.` | Headlines end with periods. |
| `!` at end of headline / button | No exclamation marks. |
| `Let's `, `let's `, `we'll get you` | Wrong voice. Use "you". |

---

## 8. Self-check before finishing

- [ ] Headings use `var(--font-display)`; body uses `var(--font-body)`.
- [ ] All colors are `var(--…)` / `#fff` / focus-ring rgba / scrim rgba.
- [ ] All `border-radius` is `2px`, `999px`, or `50%` (dot/avatar/FAB).
- [ ] No `box-shadow` except focus ring and FAB.
- [ ] No gradients, no backdrop-filter.
- [ ] Every `h1`/`h2` ends with a period.
- [ ] Every page has an eyebrow above the `h1`.
- [ ] Primary buttons have `<span class="arrow">→</span>`. Hover changes color, not size.
- [ ] Tables: `--paper` rows + `--paper-soft` thead. Row hover `--paper-soft`.
- [ ] Modal scrim is `rgba(36,36,36,0.55)`. Modal has no shadow.
- [ ] Status uses dots, not pill badges.
- [ ] Container is 1180px max-width with 24px gutters.
- [ ] The page would feel at home next to `apply.artpark.info`.
