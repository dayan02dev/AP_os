"""The two ARTPARK MIS reporting templates — monthly update and quarterly
review — as data.

Server-owned so the browser renders whatever we send rather than holding its
own copy of the wording, exactly like air_catalog and founder_catalog.
Revising a section's wording needs no frontend deploy.

Content authority: docs/reference/mis-templates.md, transcribed from
`ARTPARK_Monthly_Update_Template.docx` and
`ARTPARK_Quarterly_Review_Template.docx`.

Two things there are deliberate and preserved rather than tidied:

1. The monthly Key Metrics grid is 18 rows in the template — 1 header row +
   4 group headings + 13 actual metrics. Only the 13 metrics are data here;
   seeding all 18 would create phantom rows a founder cannot fill.
2. The monthly §7 "Financials & Fundraising" section is headed "7." but its
   two sub-headings are numbered "8.1" and "8.2" in the source template
   (a leftover from a prior section order). Section numbering here follows
   the heading (7), not the stale sub-numbers.

A third spot needed a judgment call rather than a straight transcription:
`FINANCIAL_BUCKETS["annual_revenue"]` holds the template's literal example
FY labels (FY21-22 .. FY25-26 Proj) verbatim, but the reference doc itself
flags that these must be treated as *relative* to the period's own fiscal
year rather than copied forward indefinitely — see the note at that
constant. Computing the real, period-relative labels is a later task's job
(the period calendar); this catalog only carries the template's shape and
its own caveat forward.
"""
from __future__ import annotations

KINDS: tuple[str, ...] = ("monthly", "quarterly")

# ── §2 Key Metrics (monthly) ────────────────────────────────────────────────
# The template grid is 18 rows: 1 header + 4 group headings + 13 metrics.
# Only the 13 metrics are represented below, in template row order.
#
# `trl_level` is the only computed metric: it is populated read-only from
# the founder's current verified AIR level so the AIR scorecard and the MIS
# can never disagree. Every other metric is founder-typed.
#
# Rows 6 and 7 (`product_metric_1`, `product_metric_2`) are venture-defined
# in the template: their labels are editable per venture and their `target`
# cells carry example text rather than a value in the source. That editing
# behaviour belongs to the entry-time UI, not this static catalog.
METRICS: list[dict] = [
    {"key": "revenue_month", "label": "Revenue this month (₹ Lakh)", "group": "commercial", "unit": "₹L", "computed": False},
    {"key": "active_customers", "label": "Active paying customers / pilots", "group": "commercial", "unit": "count", "computed": False},
    {"key": "new_lois", "label": "New LOIs / MoUs signed", "group": "commercial", "unit": "count", "computed": False},
    {"key": "weighted_pipeline", "label": "Weighted pipeline (₹ Lakh)", "group": "commercial", "unit": "₹L", "computed": False},
    {"key": "deployments_field", "label": "Deployments in field", "group": "product_technology", "unit": "count", "computed": False},
    {"key": "product_metric_1", "label": "Key product metric #1", "group": "product_technology", "unit": "free — e.g. accuracy, uptime", "computed": False},
    {"key": "product_metric_2", "label": "Key product metric #2", "group": "product_technology", "unit": "free — e.g. BOM cost, latency", "computed": False},
    {"key": "trl_level", "label": "TRL Level (1–9)", "group": "product_technology", "unit": "1–9", "computed": True},
    {"key": "cash_in_bank", "label": "Cash in bank (₹ Cr)", "group": "financials", "unit": "₹Cr", "computed": False},
    {"key": "net_burn_month", "label": "Net burn / month (₹ Lakh)", "group": "financials", "unit": "₹L", "computed": False},
    {"key": "runway_months", "label": "Runway (months)", "group": "financials", "unit": "months", "computed": False},
    {"key": "headcount_eom", "label": "Headcount (end of month)", "group": "team", "unit": "count", "computed": False},
    {"key": "net_hires_month", "label": "Net hires this month", "group": "team", "unit": "count", "computed": False},
]

METRIC_GROUPS: list[dict] = [
    {"key": "commercial", "label": "Commercial"},
    {"key": "product_technology", "label": "Product / Technology"},
    {"key": "financials", "label": "Financials"},
    {"key": "team", "label": "Team"},
]

# ── Sections ─────────────────────────────────────────────────────────────
# Section "type" denotes the primary rendering shape of that section:
#   narrative  -> free-text prompts, see NARRATIVE_FIELDS
#   entries    -> repeating rows, see ENTRY_FIELDS + CARRY_FORWARD
#   metrics    -> the §2 Key Metrics grid (METRICS / METRIC_GROUPS)
#   financials -> the §6 numeric series grids (FINANCIAL_SERIES / FINANCIAL_BUCKETS)
#   headcount  -> the §8 headcount grid (HEADCOUNT_CATEGORIES)
#
# A few sections are composite in the source template — e.g. quarterly §6
# "Financials" is a numeric grid *plus* a narrative sub-part (6.3), and
# quarterly §8 "People" is a headcount grid *plus* a narrative sub-part.
# Their "type" reflects the primary grid, and their narrative sub-fields are
# still recorded in NARRATIVE_FIELDS under the same section id — nothing
# from the source is dropped, but the top-level `type` — the single value
# each section is allowed here — names only the dominant shape.
#
# Quarterly §9 "Milestone Review & Next-Quarter Plan" is the most composite
# section in either template: 9.1 is a "planned vs. actual" entries table,
# 9.2 is a second, distinct entries table ("next_milestones"), and 9.3 is an
# optional narrative field for the Governing Council. The section itself is
# represented here as id "planned_vs_actual" / type "entries" (9.1, the
# part the source doc singles out as "the signal ARTPARK uses to
# calibrate"); "next_milestones" is a second, independently keyed entries
# schema (in ENTRY_FIELDS / CARRY_FORWARD) that hangs off the same section
# in the UI, and the 9.3 narrative prompt is recorded under
# NARRATIVE_FIELDS["planned_vs_actual"].
SECTIONS: dict[str, list[dict]] = {
    "monthly": [
        {
            "id": "exec_summary", "number": 1, "title": "Executive Summary",
            "hint": "5 bullets. If your ARTPARK POC only reads this section, they should know whether you're on track. Write this last.",
            "type": "narrative",
        },
        {
            "id": "key_metrics", "number": 2, "title": "Key Metrics",
            "hint": "Keep the metric list stable month-on-month — do not change definitions to make things look better. Add rows for your business-specific KPIs.",
            "type": "metrics",
        },
        {
            "id": "milestones", "number": 3, "title": "Technical, Product & Regulatory Milestones",
            "hint": "The most important section for a deeptech at Seed / early-Series-A stage — technical progress is a stronger signal of health than revenue. Include what shipped this month (mark 'Done') as well as active and upcoming milestones. Carry the same list forward month-to-month so trajectory is visible.",
            "type": "entries",
        },
        {
            "id": "traction", "number": 4, "title": "Commercial & Customer Traction",
            "hint": "§4.2 is where you show ARTPARK you're learning, not just executing.",
            "type": "narrative",
        },
        {
            "id": "risks", "number": 5, "title": "Lowlights & Risks",
            "hint": "The credibility section. Cover 2–4 real issues, honestly, with mitigation plans. Hiding lowlights makes the good news less believable.",
            "type": "entries",
        },
        {
            "id": "team_hiring", "number": 6, "title": "Team & Hiring",
            "hint": "Named hires and specific open roles are more useful than headcount alone.",
            "type": "narrative",
        },
        {
            # Template quirk — preserved. Headed "7." in the source, but its
            # two sub-headings are numbered "8.1 This month's snapshot" and
            # "8.2 Fundraising status" (stale from a prior section order).
            # Numbering here follows the heading, 7, not the sub-numbers.
            "id": "financials_fundraising", "number": 7, "title": "Financials & Fundraising",
            "hint": None,
            "type": "narrative",
        },
        {
            "id": "asks", "number": 8, "title": "Asks from ARTPARK",
            "hint": "Top 2–4 asks, in priority order. Be specific and named — 'customer intros' is hard to action; 'intro to VP Ops at Company X' gets results. Don't list one ask per category unless you genuinely need help in each.",
            "type": "entries",
        },
        {
            "id": "happy_news", "number": 9, "title": "Happy News & Demos",
            "hint": "Optional but encouraged.",
            "type": "narrative",
        },
    ],
    "quarterly": [
        {
            "id": "glance", "number": 1, "title": "Quarter at a Glance",
            "hint": None,
            "type": "narrative",
        },
        {
            "id": "ip_assets", "number": 2, "title": "IP Register",
            "hint": None,
            "type": "entries",
        },
        {
            "id": "collaborations", "number": 3, "title": "Collaborations & Programmes",
            "hint": None,
            "type": "entries",
        },
        {
            "id": "publications", "number": 4, "title": "Publications & Intellectual Activities",
            "hint": None,
            "type": "entries",
        },
        {
            "id": "products", "number": 5, "title": "Products / Technologies Developed",
            "hint": "This is a portfolio view; update quarterly.",
            "type": "entries",
        },
        {
            "id": "financials", "number": 6, "title": "Financials",
            "hint": (
                "Split between orders / paid pilots on books versus payment actually received. "
                "The Gap row (red) is what ARTPARK most needs to see — it drives how we plan support around you."
            ),
            "type": "financials",
        },
        {
            "id": "funding", "number": 7, "title": "External Funding — All-Time History",
            "hint": "This is a cap-table narrative — cumulative, not just this quarter.",
            "type": "entries",
        },
        {
            "id": "headcount", "number": 8, "title": "People",
            "hint": None,
            "type": "headcount",
        },
        {
            "id": "planned_vs_actual", "number": 9, "title": "Milestone Review & Next-Quarter Plan",
            "hint": "Include the ones that slipped or were dropped — that's the signal ARTPARK uses to calibrate.",
            "type": "entries",
        },
    ],
}

# ── Narrative prompts ────────────────────────────────────────────────────
# section id -> [{"id", "prompt"}]. Where the source gives an explicit
# Field id / Prompt table (monthly §1 and §4), the prompt text is
# transcribed verbatim. Elsewhere the source only lists field ids inline
# (e.g. "`team.headcount` · `team.joined` · ..."); those prompts are
# humanised from the field id since the source gives no prompt sentence.
NARRATIVE_FIELDS: dict[str, list[dict]] = {
    "exec_summary": [
        {"id": "exec.headline_win", "prompt": "Headline win"},
        {"id": "exec.biggest_concern", "prompt": "Biggest concern"},
        {"id": "exec.commercial", "prompt": "Commercial"},
        {"id": "exec.cash", "prompt": "Cash"},
        {"id": "exec.top_ask", "prompt": "Top ask from ARTPARK this month"},
    ],
    "traction": [
        {"id": "traction.active_pilots", "prompt": "Active paid pilots"},
        {"id": "traction.conversions", "prompt": "Conversions this month (or \"none this month\")"},
        {"id": "traction.pipeline", "prompt": "Pipeline"},
        {"id": "traction.losses", "prompt": "Losses (or \"none\")"},
        {"id": "traction.sharpest_wedge", "prompt": "§4.2 — Sharpest wedge"},
        {"id": "traction.not_working", "prompt": "§4.2 — What isn't working"},
    ],
    "team_hiring": [
        {"id": "team.headcount", "prompt": "Headcount"},
        {"id": "team.joined", "prompt": "Joined"},
        {"id": "team.left", "prompt": "Left"},
        {"id": "team.open_roles", "prompt": "Open roles"},
    ],
    "financials_fundraising": [
        {"id": "fin.revenue", "prompt": "Revenue"},
        {"id": "fin.gross_margin", "prompt": "Gross margin"},
        {"id": "fin.cash_burn", "prompt": "Cash burn"},
        {"id": "fin.cash_and_runway", "prompt": "Cash and runway"},
        {"id": "fund.round_in_progress", "prompt": "Round in progress"},
        {"id": "fund.investor_conversations", "prompt": "Investor conversations"},
        {"id": "fund.non_dilutive", "prompt": "Non-dilutive funding"},
    ],
    "happy_news": [
        {"id": "happy.field_story", "prompt": "Field story"},
        {"id": "happy.recognition", "prompt": "Recognition"},
        {"id": "happy.demos_links", "prompt": "Demos / links"},
    ],
    "glance": [
        {"id": "glance.strategic_theme", "prompt": "Strategic theme"},
        {"id": "glance.biggest_milestone", "prompt": "Biggest milestone"},
        {"id": "glance.biggest_miss", "prompt": "Biggest miss"},
        {"id": "glance.commercial_funding_position", "prompt": "Commercial / funding position"},
        {"id": "glance.next_quarter_bet", "prompt": "Next quarter bet"},
    ],
    # §6.3 Cash & burn narrative, attached to the "financials" section
    # (type "financials") alongside its numeric series grids.
    "financials": [
        {"id": "fin6.cash_in_bank", "prompt": "Cash in bank"},
        {"id": "fin6.quarterly_burn", "prompt": "Quarterly burn"},
        {"id": "fin6.runway", "prompt": "Runway"},
        {"id": "fin6.gross_margin_trajectory", "prompt": "Gross margin trajectory"},
        {"id": "fin6.gap_closing_plan", "prompt": "Gap-closing plan"},
        {"id": "fin6.revenue_commentary", "prompt": "Revenue commentary"},
    ],
    # §8 People narrative, attached to the "headcount" section (type
    # "headcount") alongside its headcount-by-category grid. Diversity may
    # legitimately read "not tracked yet — will start Q2" per the source.
    "headcount": [
        {"id": "people.diversity", "prompt": "Diversity"},
        {"id": "people.key_hires", "prompt": "Key hires"},
        {"id": "people.attrition", "prompt": "Attrition"},
        {"id": "people.structure_changes", "prompt": "Structure changes"},
    ],
    # §9.3, optional, attached to the "planned_vs_actual" section alongside
    # its two entries tables (9.1 planned_vs_actual, 9.2 next_milestones).
    "planned_vs_actual": [
        {"id": "gc.strategic_questions", "prompt": "Strategic questions for the Governing Council"},
    ],
}

# ── Entry (repeating-row) field schemas ─────────────────────────────────
# entry section -> [{"key", "label", "type", "options"?}]. type is one of
# text|int|numeric|date|bool|choice. Transcribed field-for-field from the
# source's Field / Type tables.
ENTRY_FIELDS: dict[str, list[dict]] = {
    "milestones": [
        {"key": "milestone", "label": "Milestone", "type": "text"},
        {"key": "owner", "label": "Owner", "type": "text"},
        {"key": "status", "label": "Status", "type": "choice", "options": ["Done", "On Track", "At Risk", "Blocked"]},
        {"key": "notes", "label": "Notes", "type": "text"},
    ],
    "risks": [
        # Template labels these "red / blocked" and "amber / at risk"; the
        # stored value is the short code.
        {"key": "severity", "label": "Severity", "type": "choice", "options": ["red", "amber"]},
        {"key": "what_happened", "label": "What happened", "type": "text"},
        {"key": "impact", "label": "Impact", "type": "text"},
        {"key": "mitigation", "label": "Mitigation", "type": "text"},
    ],
    "asks": [
        {"key": "priority", "label": "Priority", "type": "int"},
        {
            "key": "category", "label": "Category", "type": "choice",
            "options": [
                "customer_partnership_intros", "investor_intros", "hiring_referrals",
                "artgarage_facility", "iisc_labs_faculty", "non_dilutive_capital",
                "regulatory_policy", "advisor_time",
            ],
        },
        {"key": "ask", "label": "Ask", "type": "text"},
    ],
    "ip_assets": [
        {"key": "bucket", "label": "Bucket", "type": "choice", "options": ["filed", "granted", "rejected", "international", "cumulative"]},
        {"key": "category", "label": "Category", "type": "choice", "options": ["patent", "design", "trademark", "copyright"]},
        {"key": "title", "label": "Title", "type": "text"},
        {"key": "tech_area", "label": "Tech area", "type": "text"},
        {"key": "filing_year", "label": "Filing year", "type": "int"},
        {"key": "grant_year", "label": "Grant year", "type": "int"},
        {"key": "patent_id", "label": "Patent ID", "type": "text"},
        {"key": "scope", "label": "Scope", "type": "choice", "options": ["national", "international"]},
        {"key": "country", "label": "Country", "type": "text"},
        {"key": "rejection_status", "label": "Rejection status", "type": "text"},
        {"key": "ownership", "label": "Ownership", "type": "choice", "options": ["startup_owned", "joint_with_artpark"]},
        {"key": "commercialises_product", "label": "Commercialises product", "type": "text"},
    ],
    "collaborations": [
        {"key": "bucket", "label": "Bucket", "type": "choice", "options": ["active", "new", "completed", "in_discussion"]},
        {"key": "collaborator", "label": "Collaborator", "type": "text"},
        {"key": "country", "label": "Country", "type": "text"},
        {"key": "programme_title", "label": "Programme title", "type": "text"},
        {"key": "technology_area", "label": "Technology area", "type": "text"},
        {"key": "application_area", "label": "Application area", "type": "text"},
        {"key": "our_role", "label": "Our role", "type": "text"},
        {"key": "their_role", "label": "Their role", "type": "text"},
        {"key": "funding_lakh", "label": "Funding (₹ Lakh)", "type": "numeric"},
        {"key": "project_value_lakh", "label": "Project value (₹ Lakh)", "type": "numeric"},
        {"key": "mou_date", "label": "MoU date", "type": "date"},
        {"key": "start_date", "label": "Start date", "type": "date"},
        {"key": "end_date", "label": "End date", "type": "date"},
        {"key": "status", "label": "Status", "type": "text"},
        {"key": "outcomes", "label": "Outcomes", "type": "text"},
    ],
    "publications": [
        {"key": "bucket", "label": "Bucket", "type": "choice", "options": ["published", "in_review", "standards_policy"]},
        {"key": "kind", "label": "Kind", "type": "choice", "options": ["journal", "conference", "book_chapter", "open_dataset", "standards", "policy"]},
        {"key": "title", "label": "Title", "type": "text"},
        {"key": "authors", "label": "Authors", "type": "text"},
        {"key": "venue", "label": "Venue", "type": "text"},
        {"key": "date", "label": "Date", "type": "date"},
        {"key": "peer_reviewed", "label": "Peer reviewed", "type": "bool"},
        {"key": "scope", "label": "Scope", "type": "choice", "options": ["national", "international"]},
        {"key": "doi_or_link", "label": "DOI / link", "type": "text"},
    ],
    "products": [
        {"key": "title", "label": "Title", "type": "text"},
        {"key": "type", "label": "Type", "type": "choice", "options": ["product", "platform", "service", "toolkit"]},
        {"key": "technology_area", "label": "Technology area", "type": "text"},
        {"key": "project_value_lakh", "label": "Project value (₹ Lakh)", "type": "numeric"},
        {"key": "trl", "label": "TRL", "type": "int"},
        {"key": "development_status", "label": "Development status", "type": "text"},
        {"key": "commercialisation_status", "label": "Commercialisation status", "type": "text"},
        {"key": "commercialisation_date", "label": "Commercialisation date", "type": "date"},
        {"key": "revenue_lakh", "label": "Revenue (₹ Lakh)", "type": "numeric"},
        {"key": "industry_licensee", "label": "Industry licensee", "type": "text"},
        {"key": "commercialisation_mode", "label": "Commercialisation mode", "type": "text"},
        {"key": "deployment_status", "label": "Deployment status", "type": "text"},
        {"key": "deployment_sites", "label": "Deployment sites", "type": "text"},
    ],
    "funding": [
        {"key": "name", "label": "Name", "type": "text"},
        {"key": "status", "label": "Status", "type": "choice", "options": ["closed", "in_review", "in_discussion"]},
        {"key": "stage", "label": "Stage", "type": "text"},
        {"key": "date", "label": "Date", "type": "date"},
        {"key": "amount_lakh", "label": "Amount (₹ Lakh)", "type": "numeric"},
        {"key": "post_money_lakh", "label": "Post-money (₹ Lakh)", "type": "numeric"},
        {"key": "valuation_date", "label": "Valuation date", "type": "date"},
        {"key": "mode", "label": "Mode", "type": "text"},
        {"key": "equity_pct", "label": "Equity %", "type": "numeric"},
        {"key": "remarks", "label": "Remarks", "type": "text"},
    ],
    "planned_vs_actual": [
        {"key": "planned", "label": "Planned", "type": "text"},
        {"key": "achieved", "label": "Achieved", "type": "text"},
        {"key": "outcome", "label": "Outcome", "type": "choice", "options": ["met", "missed", "partial", "dropped"]},
        {"key": "reason", "label": "Reason", "type": "text"},
        {"key": "corrective_action", "label": "Corrective action", "type": "text"},
    ],
    "next_milestones": [
        {"key": "milestone", "label": "Milestone", "type": "text"},
        {"key": "target_date", "label": "Target date", "type": "date"},
    ],
}

# ── §6 Financials (quarterly) ────────────────────────────────────────────
# 6.1 Annual revenue: two series, six buckets (four completed FYs + the
# current FY split into YTD / Proj).
#
# The source hard-codes the six bucket labels as literal FY strings
# (FY21-22 .. FY25-26 Proj) and, in the same breath, says to treat them as
# *relative* to the period's own fiscal year rather than copying 2021
# forward indefinitely. This catalog carries the template's literal
# example labels verbatim (below) because that is what the template says
# today; a later task (the period calendar) is responsible for deriving
# the real, period-relative FY labels for a given founder rather than
# reusing these forever. Do not treat this list as an eternal source of
# truth for "the current six FYs".
FINANCIAL_SERIES: dict[str, list[dict]] = {
    "annual_revenue": [
        {"key": "annual_revenue_booked", "label": "Revenue: orders / paid pilots on books"},
        {"key": "annual_revenue_received", "label": "Revenue: payment received"},
    ],
    "needs": [
        {"key": "needs_total", "label": "Total needs"},
        {"key": "needs_confirmed", "label": "Confirmed funding"},
        {"key": "needs_projected", "label": "Projected (likely, not confirmed)"},
        {"key": "needs_gap", "label": "Gap"},
    ],
}

FINANCIAL_BUCKETS: dict[str, list[str]] = {
    "annual_revenue": ["FY21-22", "FY22-23", "FY23-24", "FY24-25", "FY25-26 YTD", "FY25-26 Proj"],
    # needs_gap is computed (needs_total - needs_confirmed - needs_projected), never typed.
    "needs": ["Q1 (Current)", "Q2 (Next)", "Q3", "Q4", "Q5"],
}

# ── §8 People (quarterly) ────────────────────────────────────────────────
HEADCOUNT_CATEGORIES: list[dict] = [
    {"key": "artpark_associated", "label": "Employees (ARTPARK, associated with startup)"},
    {"key": "startup", "label": "Employees (Startup, not ARTPARK)"},
    {"key": "consultants", "label": "Consultants"},
    {"key": "interns", "label": "Interns"},
]

# ── §4 Carry-forward rules ───────────────────────────────────────────────
# entry section -> "all" | "open_only" | "buckets:<bucket,bucket,...>" | "none".
# Only entries-schema sections appear here (metrics, financials and
# headcount have their own carry-forward shapes described in
# docs/reference/mis-templates.md §4, not this enum — they copy row shape
# with blanked amounts rather than a whole/filtered/none row-copy).
CARRY_FORWARD: dict[str, str] = {
    "ip_assets": "all",
    "funding": "all",
    "products": "all",
    "milestones": "open_only",
    "collaborations": "buckets:active,in_discussion",
    "risks": "none",
    "asks": "none",
    "publications": "none",
    "planned_vs_actual": "none",
    "next_milestones": "none",
}


def entry_fields(section: str) -> list[dict]:
    """Field schema for an entries section. Raises KeyError on an unknown
    section — never returns a default. A typo here must be loud, not a
    silently ungated question (Phase 2 shipped a lookup that returned 0 for
    an unknown key, and that quietly turned an unknown question into an
    ungated one)."""
    return ENTRY_FIELDS[section]


def section(kind: str, section_id: str) -> dict:
    """The section row for (kind, section_id). Raises KeyError on an
    unknown kind or section id — never returns None. See entry_fields for
    why lookups here must fail closed."""
    for s in SECTIONS[kind]:
        if s["id"] == section_id:
            return s
    raise KeyError(f"no such section: {kind}/{section_id}")
