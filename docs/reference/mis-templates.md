# ARTPARK MIS reporting — template source

Source of truth for `backend/app/services/mis_catalog.py`. Transcribed from the two
ARTPARK templates a VIP founder fills:

- `ARTPARK_Monthly_Update_Template.docx`
- `ARTPARK_Quarterly_Review_Template.docx`

Where a template has a quirk it is preserved and flagged rather than tidied.

The quarterly template states the structural principle itself, and the schema follows it:
*"narrative bullets where each covers one entity … Grids are used only where the content
is genuinely tabular."* So numeric time series are typed columns; entity lists are
catalog-driven rows; prose is narrative fields on the period.

---

## Storage shape

| Kind | Where it lives |
|---|---|
| Numeric series the dashboard charts | `vip_mis_metrics`, `vip_mis_financials`, `vip_mis_headcount` |
| Repeating entities (one row per IP asset, collaboration, product, …) | `vip_mis_entries` — `(section, sort_order, data jsonb)` |
| Prose | `vip_mis_periods.narrative` jsonb, keyed by the field ids below |

---

## 1. Monthly update

Nine sections. Header line carries: startup name, one-line description, sector, stage,
month/year, submitter, ARTPARK POC.

### §1 Executive Summary — narrative

*"5 bullets. If your ARTPARK POC only reads this section, they should know whether you're
on track. Write this last."*

| Field id | Prompt |
|---|---|
| `exec.headline_win` | Headline win |
| `exec.biggest_concern` | Biggest concern |
| `exec.commercial` | Commercial |
| `exec.cash` | Cash |
| `exec.top_ask` | Top ask from ARTPARK this month |

### §2 Key Metrics — `vip_mis_metrics`

The template's grid is **18 rows: 1 header + 4 group headings + 13 metrics.** Only the 13
are data. Columns: Target · Actual · vs Last Mo · Commentary. *"Keep the metric list stable
month-on-month — do not change definitions to make things look better. Add rows for your
business-specific KPIs."*

`vs Last Mo` is **computed** from the previous submitted period's `actual`, never typed —
that is what `prev_actual` on the row is for.

Commentary carries a RAG colour: **green** = ahead / on plan · **amber** = behind but
recoverable · **red** = blocked / material risk.

| # | `metric_key` | Label | Group | Unit |
|---|---|---|---|---|
| 1 | `revenue_month` | Revenue this month (₹ Lakh) | `commercial` | ₹L |
| 2 | `active_customers` | Active paying customers / pilots | `commercial` | count |
| 3 | `new_lois` | New LOIs / MoUs signed | `commercial` | count |
| 4 | `weighted_pipeline` | Weighted pipeline (₹ Lakh) | `commercial` | ₹L |
| 5 | `deployments_field` | Deployments in field | `product_technology` | count |
| 6 | `product_metric_1` | Key product metric #1 | `product_technology` | free — *e.g. accuracy, uptime* |
| 7 | `product_metric_2` | Key product metric #2 | `product_technology` | free — *e.g. BOM cost, latency* |
| 8 | `trl_level` | TRL Level (1–9) | `product_technology` | 1–9 |
| 9 | `cash_in_bank` | Cash in bank (₹ Cr) | `financials` | ₹Cr |
| 10 | `net_burn_month` | Net burn / month (₹ Lakh) | `financials` | ₹L |
| 11 | `runway_months` | Runway (months) | `financials` | months |
| 12 | `headcount_eom` | Headcount (end of month) | `team` | count |
| 13 | `net_hires_month` | Net hires this month | `team` | count |

Group display order and labels: `commercial` "Commercial" · `product_technology`
"Product / Technology" · `financials` "Financials" · `team` "Team".

**`trl_level` is not typed by the founder.** It is populated read-only from the current
**verified** overall AIR level, so the AIR scorecard and the MIS cannot disagree. Rows 6
and 7 are venture-defined: their labels are editable, and their `target` cells carry
example text in the template rather than a value.

### §3 Technical, Product & Regulatory Milestones — `vip_mis_entries`, section `milestones`

*"The most important section for a deeptech at Seed / early-Series-A stage — technical
progress is a stronger signal of health than revenue. Include what shipped this month
(mark 'Done') as well as active and upcoming milestones. Carry the same list forward
month-to-month so trajectory is visible."*

| Field | Type |
|---|---|
| `milestone` | text |
| `owner` | text |
| `status` | one of `Done`, `On Track`, `At Risk`, `Blocked` |
| `notes` | text |

Carry-forward: rows whose status is not `Done` copy into the next period.

### §4 Commercial & Customer Traction — narrative

| Field id | Prompt |
|---|---|
| `traction.active_pilots` | Active paid pilots |
| `traction.conversions` | Conversions this month (or "none this month") |
| `traction.pipeline` | Pipeline |
| `traction.losses` | Losses (or "none") |
| `traction.sharpest_wedge` | §4.2 — Sharpest wedge |
| `traction.not_working` | §4.2 — What isn't working |

*"§4.2 is where you show ARTPARK you're learning, not just executing."*

### §5 Lowlights & Risks — `vip_mis_entries`, section `risks`

*"The credibility section. Cover 2–4 real issues, honestly, with mitigation plans. Hiding
lowlights makes the good news less believable."*

| Field | Type |
|---|---|
| `severity` | one of `red`, `amber` — template labels them "red / blocked" and "amber / at risk" |
| `what_happened` | text |
| `impact` | text |
| `mitigation` | text |

### §6 Team & Hiring — narrative

`team.headcount` · `team.joined` · `team.left` · `team.open_roles`
*"Named hires and specific open roles are more useful than headcount alone."*

### §7 Financials & Fundraising — narrative

`fin.revenue` · `fin.gross_margin` · `fin.cash_burn` · `fin.cash_and_runway` ·
`fund.round_in_progress` · `fund.investor_conversations` · `fund.non_dilutive`

> **Template quirk — preserved.** This section is headed "7." but its two sub-headings are
> numbered "8.1 This month's snapshot" and "8.2 Fundraising status". Section numbering in
> our UI follows the heading (7), not the stale sub-numbers.

### §8 Asks from ARTPARK — `vip_mis_entries`, section `asks`

*"Top 2–4 asks, in priority order. Be specific and named — 'customer intros' is hard to
action; 'intro to VP Ops at Company X' gets results. Don't list one ask per category
unless you genuinely need help in each."*

| Field | Type |
|---|---|
| `priority` | int (1-based) |
| `category` | one of: `customer_partnership_intros`, `investor_intros`, `hiring_referrals`, `artgarage_facility`, `iisc_labs_faculty`, `non_dilutive_capital`, `regulatory_policy`, `advisor_time` |
| `ask` | text |

Category labels: Customer / partnership intros · Investor intros · Hiring referrals ·
ARTGarage / facility · IISc labs / faculty · Non-dilutive capital · Regulatory / policy ·
Advisor time.

### §9 Happy News & Demos — narrative

`happy.field_story` · `happy.recognition` · `happy.demos_links`
*"Optional but encouraged."*

---

## 2. Quarterly review

Nine sections. *"Submit once every 3 months (April, July, October, January) for the quarter
just concluded."* Feeds ARTPARK's reporting to DST / NM-ICPS, the Governing Council and
statutory bodies.

### §1 Quarter at a Glance — narrative

`glance.strategic_theme` · `glance.biggest_milestone` · `glance.biggest_miss` ·
`glance.commercial_funding_position` · `glance.next_quarter_bet`

### §2 IP Register — `vip_mis_entries`, section `ip_assets`

Sub-grouped by `bucket`: `filed`, `granted`, `rejected`, `international`, `cumulative`.

| Field | Type |
|---|---|
| `bucket` | one of the five above |
| `category` | one of `patent`, `design`, `trademark`, `copyright` |
| `title` | text |
| `tech_area` | text |
| `filing_year` | int |
| `grant_year` | int |
| `patent_id` | text |
| `scope` | `national` or `international` |
| `country` | text |
| `rejection_status` | text |
| `ownership` | one of `startup_owned`, `joint_with_artpark` |
| `commercialises_product` | text — cross-references §5 |

**Cumulative register: carries forward in full.** This is a running portfolio, not a
per-quarter delta.

### §3 Collaborations & Programmes — `vip_mis_entries`, section `collaborations`

Sub-grouped by `bucket`: `active`, `new`, `completed`, `in_discussion`.

| Field | Type |
|---|---|
| `bucket` | one of the four above |
| `collaborator` | text |
| `country` | text |
| `programme_title` | text |
| `technology_area` | text |
| `application_area` | text |
| `our_role` | text |
| `their_role` | text |
| `funding_lakh` | numeric |
| `project_value_lakh` | numeric |
| `mou_date` | date |
| `start_date` | date |
| `end_date` | date |
| `status` | text |
| `outcomes` | text |

Carries forward: `active` and `in_discussion`.

### §4 Publications & Intellectual Activities — `vip_mis_entries`, section `publications`

Sub-grouped by `bucket`: `published`, `in_review`, `standards_policy`.

| Field | Type |
|---|---|
| `bucket` | one of the three above |
| `kind` | one of `journal`, `conference`, `book_chapter`, `open_dataset`, `standards`, `policy` |
| `title` | text |
| `authors` | text |
| `venue` | text |
| `date` | date |
| `peer_reviewed` | bool |
| `scope` | `national` or `international` |
| `doi_or_link` | text |

### §5 Products / Technologies Developed — `vip_mis_entries`, section `products`

*"This is a portfolio view; update quarterly."* Carries forward in full.

| Field | Type |
|---|---|
| `title` | text |
| `type` | one of `product`, `platform`, `service`, `toolkit` |
| `technology_area` | text |
| `project_value_lakh` | numeric |
| `trl` | int 1–9 |
| `development_status` | text |
| `commercialisation_status` | text |
| `commercialisation_date` | date |
| `revenue_lakh` | numeric |
| `industry_licensee` | text |
| `commercialisation_mode` | text |
| `deployment_status` | text |
| `deployment_sites` | text |

### §6 Financials — `vip_mis_financials` + narrative

**6.1 Annual revenue (₹).** Two series × six buckets. *"Split between orders / paid pilots
on books versus payment actually received."*

- series: `annual_revenue_booked` ("Revenue: orders / paid pilots on books"),
  `annual_revenue_received` ("Revenue: payment received")
- buckets, in order: `FY21-22`, `FY22-23`, `FY23-24`, `FY24-25`, `FY25-26 YTD`, `FY25-26 Proj`

> The template hard-codes those FY labels. Treat them as **relative** — five historical
> years, then YTD and projection for the current FY — and generate the labels from the
> period's own fiscal year rather than copying 2021 forward indefinitely.

**6.2 Financial needs over next 5 quarters (₹ Lakh).** Four series × five buckets.
*"The Gap row (red) is what ARTPARK most needs to see — it drives how we plan support
around you."*

- series: `needs_total` ("Total needs"), `needs_confirmed` ("Confirmed funding"),
  `needs_projected` ("Projected (likely, not confirmed)"), `needs_gap` ("Gap")
- buckets: `Q1 (Current)`, `Q2 (Next)`, `Q3`, `Q4`, `Q5`
- `needs_gap` is **computed**: `needs_total − needs_confirmed − needs_projected`. Not typed.

**6.3 Cash & burn** — narrative: `fin6.cash_in_bank` · `fin6.quarterly_burn` ·
`fin6.runway` · `fin6.gross_margin_trajectory` · `fin6.gap_closing_plan` ·
`fin6.revenue_commentary`.

### §7 External Funding — All-Time History — `vip_mis_entries`, section `funding`

*"This is a cap-table narrative — cumulative, not just this quarter."* Carries forward in
full.

| Field | Type |
|---|---|
| `name` | text |
| `status` | one of `closed`, `in_review`, `in_discussion` |
| `stage` | text — e.g. Pre-seed, Seed, Series A, grant |
| `date` | date |
| `amount_lakh` | numeric |
| `post_money_lakh` | numeric |
| `valuation_date` | date |
| `mode` | text — e.g. priced round, SAFE, non-dilutive |
| `equity_pct` | numeric |
| `remarks` | text |

### §8 People — `vip_mis_headcount` + narrative

End-of-quarter headcount. Four categories plus a computed Total row. Columns: Current
Count · Exited this Qtr · Net Change · Remarks. **Net Change is computed, not typed.**

| `category` | Label |
|---|---|
| `artpark_associated` | Employees (ARTPARK, associated with startup) |
| `startup` | Employees (Startup, not ARTPARK) |
| `consultants` | Consultants |
| `interns` | Interns |

Narrative: `people.diversity` · `people.key_hires` · `people.attrition` ·
`people.structure_changes`. Diversity may legitimately read *"not tracked yet — will start
Q2"*.

### §9 Milestone Review & Next-Quarter Plan

- `vip_mis_entries` section `planned_vs_actual` — fields: `planned`, `achieved`,
  `outcome` (one of `met`, `missed`, `partial`, `dropped`), `reason`, `corrective_action`.
  *"Include the ones that slipped or were dropped — that's the signal ARTPARK uses to
  calibrate."*
- `vip_mis_entries` section `next_milestones` — fields: `milestone`, `target_date`.
- narrative `gc.strategic_questions` — §9.3, optional, for the Governing Council.

---

## 3. Period calendar

- **Monthly** — one per calendar month from the venture's onboarding month to the current
  month. `period_key` = `YYYY-MM`. Due the 5th of the following month.
- **Quarterly** — Indian FY quarters (Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar),
  matching the template's April/July/October/January instruction. `period_key` =
  `FY26-27-Q1`. Due the 15th of the month after quarter end.

Periods are generated **lazily on read**, the same convergent pattern `air_query.ensure_round`
uses: compute the expected set, insert what is missing, idempotent, nothing to schedule.

**Overdue is derived, never stored:** `status = 'draft' AND due_date < today`.

## 4. Carry-forward

A newly created period seeds from the most recent **submitted** period of the same kind.

| What | Rule |
|---|---|
| Metrics | copy `metric_key`, `label`, `group_key`, `unit`, `target`. Blank `actual` and `commentary`. Copy the previous `actual` into `prev_actual` so "vs Last Mo" is computed. |
| Milestones | copy rows whose status is not `Done` |
| IP assets, funding, products | copy **in full** — cumulative registers by definition |
| Collaborations | copy `active` and `in_discussion` buckets |
| Risks, asks, publications, planned_vs_actual, next_milestones | do not copy |
| Narrative | do not copy |
| Financials, headcount | copy the series/category rows with blank amounts, so the grid shape persists |
