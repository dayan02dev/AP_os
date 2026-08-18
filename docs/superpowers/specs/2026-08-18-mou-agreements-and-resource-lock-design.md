# MOU agreements + Founders Resources lock

**Status:** approved in brainstorm 2026-08-18
**Targets:** TIR **production** and VIP staging
**Branch:** new worktree off `release/sip-launch-v1` — must NOT carry the 180
unmerged `feat/vip-onboarding` commits into prod.

## 1. Goal

Replace the hand-written MOU with the real ARTPARK agreements, generated as a
PDF from what the founder types and signs. Separately, lock the Founders
Resources tabs until each is actually built.

## 2. Decisions taken in brainstorm

| # | Decision |
|---|---|
| D1 | **Extract-and-render.** A build-time script parses the `.docx` into a structured template; reportlab renders it with substitutions. The legal wording is extracted, never retyped. |
| D2 | **Founder types only their own party details.** ARTPARK's commercial terms are constants in code, identical for every founder. |
| D3 | **1–3 collaborators, dynamic.** Unused blocks are dropped from the PDF, never rendered as empty `[•]` lines. |
| D4 | **TIR = Facility now, Collaboration later. VIP = Facility only.** |
| D5 | **Founders Resources lock is server-driven and per item**, so each releases without a frontend deploy. |

### This closes a standing blocker

`VIP_BUILD_STATE.md` carried an open decision: *the MOU a VIP founder signs is
TIR's* — full-time campus presence, residency expense account, post-25L equity,
stamped `tir-mou-v2`. It was the one item that had to be settled before any VIP
founder could join `FOUNDER_PORTAL_ALLOWLIST`, because it is a signed legal
artefact. D4 settles it: VIP signs the Facility Agreement, nothing else.

## 3. Blocker on the Collaboration Agreement

`Collaboration_Agreement_TIR_Program_ARTPARK_Redlined_v3.docx` is still a
redlined draft — **41 tracked insertions, 52 deletions, unaccepted**. Its
placeholders sit inside deleted runs, so extraction yields broken text such as
*"having PAN s"*. It cannot be a template until a revisions-accepted copy
exists. TIR therefore ships Facility first and Collaboration in a later,
smaller deploy.

## 4. Why not fill the .docx directly

The Lambda runtime carries `reportlab`, `python-docx` and `pypdf`. It has no
LibreOffice and no docx→PDF converter; adding one is a ~500MB layer with slow
cold starts. Filling the `.docx` is easy — converting it is not. Extraction
sidesteps conversion entirely and keeps the wording exact.

**Accepted trade-off:** the output is a clean typeset document, not a pixel
match of the Word file. Fonts, indents and numbering are ours.

## 5. Field map — Facility Agreement

22 `[•]` placeholders, in three groups:

**Founder-supplied (12)** — per collaborator, up to three:
`name`, `pan`, `parent_name` (s/o/d/o), `address`.

**ARTPARK constants (6)** — `term_months` (appears twice: numeral and words),
`insurance_limit`, `collaboration_agreement_date`, and the execution
`[month]`/`[date]`. Set once in code.

**Facilities schedule (4)** — the "Availability Window" cells for Dedicated
Seating, Laboratory Space, Computing Resources and the remaining row. ARTPARK's
allocation, not the founder's. Constants.

Tables 2 and 3 (lab space, activities) ship as-is; they are empty schedules in
the source.

## 6. Architecture

**`scripts/extract_agreement_template.py`** — run by a human when a new
agreement `.docx` arrives. Walks paragraphs and tables in order, preserves
`[•]` markers and table structure, emits
`app/services/agreements/<slug>.json`. Committed to the repo, so the runtime
never reads a `.docx` and prod needs no Word file on disk.

**`app/services/agreements.py`** — loads a template, substitutes founder values
and ARTPARK constants in order, renders with reportlab, embeds the signature
image, returns bytes. One renderer for every agreement.

**Field schema served from the backend**, same catalog pattern as AIR and MIS,
so wording changes need no frontend deploy.

**Endpoints** extend the existing `/founder/mou` surface rather than replacing
it: `GET` returns the field schema plus current values and signed state; sign
accepts the field values plus the signature and generates the PDF(s).

**Storage and versioning.** Each generated PDF is stored per (track,
application, agreement). `mou_version` moves to `facility-v1`. Production holds
exactly one signed row, signer `OOOO` — a test row — so no real signature is
invalidated.

## 7. Founder MOU tab

The acknowledgement checklist is replaced by:

1. **Your details** — 1–3 collaborator blocks, add/remove.
2. **Review** — the rendered agreement text with values substituted inline, so
   the founder reads exactly what they are signing.
3. **Sign** — existing signature pad.
4. **Download** — the generated PDF, retrievable afterwards.

TIR shows Facility now and Collaboration when it exists; VIP shows Facility
only. The list of agreements comes from the backend per track — the frontend
never hardcodes which track gets which document.

## 8. Founders Resources lock

Five nav items — Art Infra, ArtConnect, ArtPartners, Art Assets, Art Support —
are locked because the backend is unbuilt.

**Not the existing `locked` mechanism.** That one is conditional on signing the
MOU and unlocks as a group; this is "not built yet" and releases one item at a
time.

`/founder/me` gains a per-item availability set. The sidebar renders unavailable
items visibly disabled and non-clickable, and **a route guard blocks direct URL
entry** — typing `/founder/store` must not open it. Releasing an item is a
backend config change, no deploy of the frontend.

Applies to **both** TIR prod and VIP staging.

## 9. Testing

- The extractor is tested against the real `.docx`: paragraph count, order,
  `[•]` count, and table structure preserved. If the source changes and the
  extraction drifts, the test fails.
- Rendering: two collaborators must not emit a third empty block; ARTPARK
  constants must appear; no literal `[•]` may survive into a generated PDF —
  asserted directly, since that is the failure a reader would notice first.
- The lock: each of the five routes is unreachable by URL while unavailable,
  and reachable once its flag flips. A test proves the guard, not just the
  sidebar styling.
- Existing MOU tests are updated, not deleted — the signed-state and
  signature-embedding contracts still hold.

## 10. Rollout

Two production deploys, in order:

1. **Founders Resources lock** — small, low risk, immediate value.
2. **Facility Agreement MOU** — after the lock is verified in prod.

Collaboration Agreement follows when a clean copy arrives. VIP staging takes
the same changes on `feat/vip-onboarding`. Vercel promote remains the user's
action, as always.
