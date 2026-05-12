# ARTPARK EIR — Design System Audit

> Generated 2026-05-12 from `frontend/src/` on the `staging` branch.

---

## 1. STACK

| Layer | Value |
|-------|-------|
| Framework | React 18.3.1 + React Router DOM 6.26.0 |
| Bundler | Vite 5.4.0 |
| CSS approach | **Pure CSS with CSS custom properties** — single `styles.css` file, no Tailwind/PostCSS/CSS Modules |
| Component library | **None** — all custom-built |
| Icon library | **None** — inline SVGs + Unicode glyphs (✓, ↳, ⏎, ✉, ▦, ∅) |
| Fonts | Google Fonts: **Instrument Serif** (display), **Geist** (body/UI), **JetBrains Mono** (code/labels), **Caveat** (script accents), **Newsreader** (serif fallback) |
| Test runner | Vitest 2.1.9 + @testing-library/react |
| Auth | Supabase JS 2.45.0 |

---

## 2. DESIGN TOKENS

### 2.1 Color Tokens (`:root` defaults — "Notebook" theme)

| Token | Hex | Role |
|-------|-----|------|
| `--bg` | `#f4f1ea` | Page background |
| `--bg-soft` | `#ece7dc` | Input/card fill |
| `--ink` | `#1a1a1a` | Primary text |
| `--ink-soft` | `#4a4a45` | Secondary text |
| `--ink-dim` | `#8a867c` | Muted/disabled text |
| `--line` | `#d7d1c2` | Borders, dividers |
| `--line-strong` | `#bab4a3` | Stronger borders, input underlines |
| `--accent` | `#c84a1a` | Primary action / links (TIR default) |
| `--accent-soft` | `#f0d9cc` | Selected option bg |
| `--chip` | `#e5e0d2` | Chip/tag background, hover bg |

**SIP accent overrides:**
| Token | Hex |
|-------|-----|
| `--accent` | `#6B5CFF` |
| `--accent-deep` | `#4a3dd6` |
| `--accent-soft` | `#ece9ff` |

**Semantic colors (hardcoded, not tokenized):**
| Role | Hex |
|------|-----|
| Success / valid | `#2f9e4f`, `#2a7a3a` |
| Error / invalid | `#c84a1a`, `#c4341a` |
| Disabled opacity | `0.35` |

### 2.2 Full Theme Matrix

Six themes defined in `themes.jsx`:

| Theme | `--bg` | `--ink` | `--accent` | `--accent-soft` | bg pattern |
|-------|--------|---------|------------|-----------------|------------|
| **Notebook** | `#f4f1ea` | `#1a1a1a` | `#3213b7` | `#aafcf0` | grid |
| **Terminal** | `#0e0f0d` | `#e7e5de` | `#b8ff5c` | `#2c3a1c` | terminal |
| **Editorial** | `#f6efe1` | `#1e1a15` | `#3213b7` | `#aafcf0` | editorial |
| **Blueprint** | `#e7ecef` | `#0a1a2b` | `#3213b7` | `#aafcf0` | blueprint |
| **Journal** | `#fbf7ef` | `#221c14` | `#3213b7` | `#aafcf0` | lines |
| **Minimal** | `#fafaf7` | `#0a0a0a` | `#3213b7` | `#aafcf0` | none |

### 2.3 Type Scale

| Role | Size | Line-height | Weight | Font |
|------|------|-------------|--------|------|
| Display / welcome title | `clamp(44px, 6vw, 78px)` | 1.02 | 400 | `--font-serif` |
| Section intro index | `clamp(100px, 16vw, 200px)` | 0.9 | 400 | `--font-serif` |
| Section intro title | `clamp(36px, 5vw, 56px)` | 1.05 | 400 | `--font-serif` |
| Question prompt (TIR) | `clamp(30px, 4vw, 44px)` | 1.12 | 400 | `--font-serif` |
| Question prompt (SIP) | `clamp(24px, 2.8vw, 34px)` | 1.18 | 600 | `--font-serif` |
| Done title | `clamp(40px, 5.5vw, 64px)` | 1.05 | 400 | `--font-serif` |
| Celebrate title | `clamp(32px, 4.5vw, 48px)` | — | 400 | `--font-serif` |
| Modal / section heading | 26px | 1.1 | 400 | `--font-serif` |
| Card title | 22px | 1.2 | — | `--font-serif` |
| Body / lede | 18px | 1.55 | — | inherit (sans) |
| Body default | 16px | 1.5 | — | `--font-sans` |
| Help text | 15px | — | — | inherit |
| Input (short) | 22px | 1.4 | — | `--font-sans` |
| Input (textarea) | 17px | 1.55 | — | `--font-sans` |
| Option label | 16px | — | — | `--font-sans` |
| Button | 15px | — | 500 | `--font-sans` |
| Coordinate bar | 10.5px | — | — | `--font-mono` |
| Chip / tag | 11px | — | — | `--font-mono` |
| kbd | 0.72em | — | — | `--font-mono` |

### 2.4 Spacing Scale

Common values extracted from the codebase (not a formal scale):

`4 · 6 · 8 · 10 · 12 · 14 · 16 · 18 · 20 · 22 · 24 · 28 · 32 · 36 · 40 · 48 · 60 · 120`

Key fixed spacings:
- Frame padding: `28px 48px 120px` (desktop), `16px 18px 100px` (mobile)
- Frame gap: `28px` (desktop), `20px` (mobile)
- Action bar margin-top: `36px`
- Section intro title margin-bottom: `40px`

### 2.5 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `2px` | Buttons, inputs, options, cards, modals |
| pill | `999px` | Badges, status dots |
| circle | `50%` | Avatars, icons |

### 2.6 Shadows

| Name | Value | Usage |
|------|-------|-------|
| Button hover | `3px 3px 0 0 var(--ink-dim)` | Offset shadow on hover |
| Input invalid | `0 4px 14px -8px rgba(196,52,26,0.55)` | Red glow under invalid inputs |
| FAB | `0 6px 18px rgba(0,0,0,0.06)` | Support button |
| FAB hover | `0 10px 22px rgba(50,19,182,0.18)` | Support button hover |
| Modal | `0 24px 64px rgba(0,0,0,0.22)` | Modal overlay |
| Card raised | `0 8px 24px -8px rgba(0,0,0,0.18)` | Expanded cards |

### 2.7 Breakpoints

| Name | Value |
|------|-------|
| Small mobile | `480px` |
| Mobile | `640px` |
| Tablet-mobile | `720px` |
| Tablet | `768px` |
| Reduced motion | `prefers-reduced-motion: reduce` |

---

## 3. COMPONENT INVENTORY

### 3.1 Input Components (`inputs.jsx`)

| Component | Kind | Props |
|-----------|------|-------|
| `ShortInput` | Short text, phone, name | `q, value, onChange, autoFocus` |
| `EmailQuestionInput` | Email with validation | `q, value, onChange, autoFocus` |
| `LongInput` | Textarea with word count | `q, value, onChange, autoFocus` |
| `SingleInput` | Radio select + "Other" freetext | `q, value, onChange` |
| `MultiInput` | Multi-select checkboxes | `q, value, onChange` |
| `EvidenceFilesInput` | Drag-drop file upload | `q, value, onChange` |
| `MilestoneFilesInput` | Multi-file milestones | `q, value, onChange` |
| `DeclarationsInput` | Checkbox confirmations | `q, value, onChange` |
| `TeamInviteInput` | Co-founder cards | `q, value, onChange` |
| `QuestionInput` | Router/dispatcher | `q, value, onChange` |

### 3.2 SIP-Specific Inputs (`inputs_sip.jsx`)

| Component | Kind | Props |
|-----------|------|-------|
| `CapTableInput` | Cap table with share validation | `q, value, onChange` |
| `SingleEvidenceInput` | Single file (pitch deck, cap table) | `q, value, onChange, kind` |
| `MultiEvidenceInput` | Multi-file (patents, traction) | `q, value, onChange, kind` |
| `SipMilestoneFilesInput` | SIP milestone files | `q, value, onChange` |
| `SipQuestionInput` | Router/dispatcher | `q, value, onChange` |

### 3.3 Screen Components (`screens.jsx`)

| Component | Props |
|-----------|-------|
| `ProgressBar` | `variant, progress, currentStep, totalSteps, sectionLabel, sectionIndex, totalSections, estMin` |
| `WelcomeScreen` | `onStart, warmCopy, track` |
| `SectionIntroScreen` | `section, onContinue, onBack, totalSections` |
| `CelebrationScreen` | `message, onContinue` |
| `DoneScreen` | `answers, onRestart, submission, onBack, onDownload, questionPrompts` |

### 3.4 Auth & Upload Screens (`auth_upload.jsx`)

| Component | Purpose |
|-----------|---------|
| `AuthScreen` | Login/register mode switcher |
| `ReturningChoiceScreen` | Three-tab dashboard (Start new / Continue / Past) |
| `UploadScreen` | CV drop zone + LinkedIn/GitHub |
| `ParsingScreen` | Animated CV parsing progress |
| `ParsedReviewScreen` | Editable review of parsed fields |
| `TemplateScreen` | Offline .docx template workflow |

### 3.5 Support, Profile, Session Lock

| Component | File |
|-----------|------|
| `SupportButton` / `SupportModal` | `support.jsx` |
| `ProfileScreen` | `profile.jsx` |
| `TakeoverPrompt` / `KickedScreen` / `SessionLockBanner` | `session_lock.jsx` |

### 3.6 Page Components (`pages/`)

`SignInPage`, `SignUpPage`, `VerifyPage`, `SetPasswordPage`, `NotFoundPage`, `SupportPage`, `TrackMismatchPage`, `ProtectedRoute`

---

## 4. PAGE/LAYOUT PATTERNS

### Layout Hierarchy

```
<div class="eir-root [track-sip] [eir-theme-{name}]">
  <div class="eir-bg" />           <!-- Background pattern -->
  <div class="eir-frame">          <!-- Max-width + padding -->
    <Header />                      <!-- Fixed-position header -->
    <main class="eir-main">
      <div class="eir-screen {variant}">
        <div class="eir-coord eir-mono">  <!-- Breadcrumb bar -->
        <div class="eir-{variant}-body">  <!-- Content area -->
      </div>
    </main>
  </div>
  <SupportButton />                 <!-- Fixed FAB -->
</div>
```

### Route Structure

- **Public:** `/apply/signin`, `/apply/signup`, `/apply-sip/signup`, `/apply/verify`
- **Protected TIR:** `/apply/{basic|problem|solution|execution|evidence|declaration|review|submitted|profile|template}`
- **Protected SIP:** `/apply-sip/{basic|solution|execution|evidence|declaration|review|submitted|profile|fit-check}`

---

## 5. STATE PATTERNS

### Loading States
- **File uploads:** `busy` boolean + "Uploading..." text
- **CV parsing:** Multi-step animation with done/active/pending markers
- **Template parsing:** Three distinct messages ("Uploading...", "Reading...", "Pre-filling...")
- **Support ticket:** Animated SVG spinner during "sending" stage

### Empty States
- Team invite: `✉ ✉ ✉` icon + "No co-founders added yet"
- Cap table: `▦` icon + "No entries yet"
- Past submissions: `∅` icon + "No submissions yet"
- **Pattern:** Custom per-component, not extracted into a reusable component

### Error States
- File errors: `↳ {message}` in `.eir-block-reason` (orange text)
- Auth errors: `! {message}` in `.eir-auth-err` (orange text)
- Input validation: Red underline shadow on `.eir-input-invalid`
- **Pattern:** Mostly consistent use of `eir-block-reason` / `eir-mono`, but prefix differs (`↳` vs `!`)

---

## 6. INCONSISTENCIES & GAPS

### Hardcoded Colors Not Tokenized
- Success green (`#2f9e4f`, `#2a7a3a`) — should be `--success`
- Error red (`#c84a1a`) — same as `--accent` in default theme, confusing
- SIP accent (`#6B5CFF`) — only set via JS, not in `:root`

### Duplicate Patterns Not Extracted
- **5 file drop zone components** with near-identical drag/drop/error logic — should be one `<FileDropZone>`
- **2 modal backdrops** (`eir-sup-backdrop`, `eir-takeover-backdrop`) — should be one `<Modal>`
- **3 empty state blocks** — should be one `<EmptyState icon title subtitle />`

### Inconsistent Error Display
- `marginTop` varies: `10px`, `0.5rem`, `8px` across files
- Prefix varies: `↳` (inputs), `!` (auth), none (some modals)

### Inline Styles Overriding CSS
- Disabled/loading states use inline `{ opacity: 0.6, cursor: "not-allowed" }` instead of a CSS class
- Several components use `style={{ marginTop: N }}` instead of CSS

### Missing Patterns
- No standard `<Spinner>` component — each loading state is custom
- No standard `<Badge>` / `<Tag>` component
- No standard `<Tooltip>` — labels rely on `title` attributes
- No `<Modal>` wrapper — each modal reimplements backdrop + close + escape handling

---

## 7. DESIGN SYSTEM BRIEF

> Paste this into Claude Design's "Any other notes?" field.

**Voice & Principles:**
This is ARTPARK's application portal for deep-tech research programmes (TIR and SIP). The design language is deliberately restrained and literate — think Swiss-meets-notebook. Typography does the heavy lifting: large serif headings (Instrument Serif) for warmth, Geist sans-serif for UI/body, JetBrains Mono for technical labels and coordinates. The palette is warm off-white with muted earth tones. Accent color is contextual: rust-orange for TIR track, violet (#6B5CFF) for SIP track. Every surface feels like quality paper, not a SaaS dashboard.

**Hard Rules:**
- Border radius is always 2px — sharp, deliberate, never rounded.
- Buttons use an offset shadow on hover (3px 3px) — no gradient, no glow.
- Background patterns (grid, lines, dots) are subtle CSS-only, controlled by `--grid-opacity` (0.15–0.7).
- All color must use CSS custom properties (`--bg`, `--ink`, `--accent`, etc.) — never hardcoded hex.
- Disabled states use `opacity: 0.35`, not grey-out.
- Error text is `--accent` color with a `↳` prefix in monospace.
- The coordinate bar (top of every screen) uses 10.5px uppercase mono with 0.14em letter-spacing.

**Components to Preserve by Name:**
`eir-btn` (base button), `eir-btn-primary` / `eir-btn-ghost` / `eir-btn-disabled` (variants), `eir-option` (select card), `eir-input` (underline text input), `eir-textarea` (bordered textarea), `eir-filedrop` (drag-drop zone), `eir-coord` (breadcrumb/coordinate bar), `eir-welcome-title` (serif display heading), `eir-q-prompt` (question heading), `eir-q-actions` (button bar), `eir-mono` (monospace utility), `eir-dim` (muted text utility).

**Density:**
Medium density — generous vertical rhythm (36px action bar margin, 28px input wrap margin, 8px option gaps). The app is a long-form questionnaire; breathing room prevents fatigue. Mobile collapses gracefully with `clamp()` typography and stacked buttons.

**Patterns to Reproduce:**
- Phase machine architecture: Welcome → Upload → Parse → Questions → Review → Done
- Three-tab returning user screen (Start new / Continue existing / Past applications)
- Inline file attachment zones below textarea questions
- Section celebration interstitials between question groups
- Milestone pipeline visualization for past submissions

**Patterns to Avoid:**
- No card-heavy dashboards — this is a linear wizard, not a grid layout
- No toast notifications for saves — use the status bar at bottom-left ("SAVED ✓" / "SAVE FAILED")
- No modals for form steps — every question gets a full screen
- No skeleton loaders — use subtle mono text ("checking your session...")
