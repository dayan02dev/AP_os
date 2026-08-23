# Demo Environment — Product Manager Handout

Every founder name, email address and company you see in this environment is
fake. None of it belongs to a real person. This is a copy of a real system
with the identities swapped out, built so a new product manager can learn the
product without touching production. Treat it as disposable — it can be wiped
and rebuilt at any time, and nothing you do here reaches a real applicant.

## What this is

ARTPARK runs a platform that takes a startup founder from "submitted an
application" through screening, review, a shortlist decision, a final
decision, and — for the ones who make it — onboarding. This environment is a
copy of that platform's staging deployment, with the real applicant data
replaced by synthetic stand-ins and a handful of applications deliberately
walked through every stage, so every screen has something real to show
instead of sitting empty.

The application *content* (the write-ups, scores, industries) is preserved
and reads like a genuine submission — only who submitted it has changed.

## How to get in

- **URL:** https://ap-os-git-staging-artpark.vercel.app
- **Account:** `demo@artpark.test`
- **Password:** ask Udayan for it. It is not written down anywhere in this
  repository, because this repository is public.

This one login holds three roles at once. After you sign in you land on the
**Leadership** dashboard. A **"Switch role"** control in the top-right corner
lets you move between Leadership, Admin and Reviewer without signing out and
back in.

## The ten-minute tour

Go through the three portals in this order — Leadership, then Admin, then
Reviewer — because that is the order signing in and clicking "Switch role"
naturally takes you.

### 1. Leadership

This is the bird's-eye view: how many applications are at each stage, how
they're scoring, and where they came from.

- **Dashboard tab** — a funnel from submitted through evaluated to accepted,
  a distribution of AI screening scores, and a breakdown by industry. This is
  the "state of the pipeline" view a leadership team checks in on.
- **Applications tab** — every application in a searchable list, each with an
  AI score and a reviewer-recommendation chip (YES / MAYBE / NO). That chip
  is not one reviewer's opinion — it's the panel's combined verdict: two or
  more reviewers have to agree before it shows YES or NO, otherwise it reads
  MAYBE. Open any row to see the full write-up, the AI-generated summary, and
  the individual reviews behind it.

Most of what you see in this list is real historical data wearing a fake
name — background volume, not part of the guided tour. Click "Switch role" →
**Admin** to continue.

### 2. Admin

This is where staff move an application through the pipeline: assign
reviewers, decide who advances, and sign off on the ones who get an offer.

- **Applications** — the full submissions list, same idea as Leadership's but
  with the tools to act on a row.
- **Admin Review** — applications whose reviews are all in and are waiting on
  a shortlist / hold / reject decision. Look here for one application whose
  panel agreed YES (ready to advance) sitting next to one where the panel
  agreed NO — the same review process, two different outcomes.
- **Accepted** — shortlisted applications waiting on their Investment
  Committee memo. This tab is the newest piece of the product, and it's
  worth slowing down on:
  - Rows still needing attention (no memo uploaded yet) sit at the **top** —
    the tab is ordered as a to-do list, not an archive.
  - One row carries a green **ACCEPTED** chip — its memo has been uploaded
    *and signed off*.
  - One row carries a red **REJECTED** chip — that application was turned
    down at this final stage. It stays visible here (rather than only in a
    generic "Rejected" bucket) specifically so a final-stage rejection is
    never invisible to the team that needs to see it.
  - You'll also spot a VIP-track application, and one that started in the
    core track and was later moved into VIP — its track badge reflects
    where it ended up, not where it began.
- **Final Gate** — the last decision point (Offer / Waitlist / Hold /
  Reject). One seeded application already has an offer recorded here.
- **Reviewers** — the review panel roster (three reviewers plus this demo
  account), each with a subject-matter focus, split across two review
  batches. This is where staff manage who is reviewing what.

Click "Switch role" → **Reviewer** to finish the tour.

### 3. Reviewer

This is the reviewer's own desk — what it looks like to actually evaluate an
application. The demo account has its own small workload seeded in, so this
portal is not empty:

- **Queue** — a few applications waiting on your review, including one
  nobody has looked at yet and one others have already weighed in on. Open
  one to see the scoring form a reviewer fills out.
- **History** — one application you've already reviewed and submitted a
  recommendation on, so you can see what a completed review looks like from
  the reviewer's side.

That's the tour. Everything you clicked through reflects a real stage a real
application moves through — the only thing manufactured for this demo is
*which* applications are sitting at which stage.

## What this does not show

Three things are deliberately out of view, so don't read their absence as a
missing feature:

- **The application wizard** — the public multi-step form a founder fills
  out to apply. It exists and is reachable, but this tour is about the
  staff-facing side of the product, not the applicant's.
- **The jury portal** — a separate screen where jury members review and pick
  applications to mentor. It's switched off for this cohort; the jury-related
  information you see on the Accepted tab was set up directly rather than
  produced by walking through that portal.
- **VIP onboarding** — the post-offer experience for founders once they've
  accepted a spot in the VIP track. It's still being built and isn't part of
  this environment yet.

## Refreshing it

Two scripts maintain this environment, both in `backend/scripts/`:

- `mask_staging_identities.py` — replaces every applicant's name, email,
  phone and organisation with a synthetic one.
- `seed_demo_cohort.py` — shapes a set of applications into the stages
  described in the tour above (fresh submission, under review, shortlisted,
  accepted, rejected, offered, and so on).

Both default to a **dry run** — they print what they would change without
touching anything — and only write when run with `--apply`. Both refuse to
run against anything other than this staging project, so there's no way to
point either one at production by mistake. Re-running them is safe.
