"""The two ARTPARK MIS templates as data.

Structural guards. Content authority: docs/reference/mis-templates.md
"""
import pytest

from app.services import mis_catalog as cat

EXPECTED_METRICS = [
    ("revenue_month", "commercial"), ("active_customers", "commercial"),
    ("new_lois", "commercial"), ("weighted_pipeline", "commercial"),
    ("deployments_field", "product_technology"), ("product_metric_1", "product_technology"),
    ("product_metric_2", "product_technology"), ("trl_level", "product_technology"),
    ("cash_in_bank", "financials"), ("net_burn_month", "financials"),
    ("runway_months", "financials"),
    ("headcount_eom", "team"), ("net_hires_month", "team"),
]


def test_thirteen_metrics_in_source_order():
    """The template grid is 18 rows, but 1 is a header and 4 are group
    headings — only 13 are metrics. Getting this wrong seeds a phantom row."""
    assert [(m["key"], m["group"]) for m in cat.METRICS] == EXPECTED_METRICS


def test_metric_labels_match_the_source_exactly():
    by_key = {m["key"]: m["label"] for m in cat.METRICS}
    assert by_key["revenue_month"] == "Revenue this month (₹ Lakh)"
    assert by_key["trl_level"] == "TRL Level (1–9)"          # en-dash, not hyphen
    assert by_key["cash_in_bank"] == "Cash in bank (₹ Cr)"
    assert by_key["headcount_eom"] == "Headcount (end of month)"


def test_trl_is_the_only_computed_metric():
    """TRL comes from the verified AIR level, never typed — if another metric
    were marked computed the founder would silently lose an input."""
    assert [m["key"] for m in cat.METRICS if m["computed"]] == ["trl_level"]


def test_metric_groups_cover_every_metric_and_are_ordered():
    order = [g["key"] for g in cat.METRIC_GROUPS]
    assert order == ["commercial", "product_technology", "financials", "team"]
    assert {m["group"] for m in cat.METRICS} == set(order)


def test_both_kinds_have_nine_numbered_sections():
    for kind in cat.KINDS:
        secs = cat.SECTIONS[kind]
        assert [s["number"] for s in secs] == list(range(1, 10)), kind


def test_every_section_declares_a_known_type():
    valid = {"narrative", "entries", "metrics", "financials", "headcount"}
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            assert s["type"] in valid, (kind, s["id"])


def test_every_entries_section_has_a_field_schema_and_a_carry_rule():
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            if s["type"] == "entries":
                assert cat.ENTRY_FIELDS.get(s["id"]), s["id"]
                assert s["id"] in cat.CARRY_FORWARD, s["id"]


def test_every_narrative_section_has_prompts():
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            if s["type"] == "narrative":
                assert cat.NARRATIVE_FIELDS.get(s["id"]), s["id"]


def test_choice_fields_declare_their_options():
    for section, fields in cat.ENTRY_FIELDS.items():
        for f in fields:
            if f["type"] == "choice":
                assert f.get("options"), (section, f["key"])


def test_milestone_status_options_match_the_template():
    status = next(f for f in cat.ENTRY_FIELDS["milestones"] if f["key"] == "status")
    assert status["options"] == ["Done", "On Track", "At Risk", "Blocked"]


def test_ask_categories_match_the_template():
    cats = next(f for f in cat.ENTRY_FIELDS["asks"] if f["key"] == "category")
    assert cats["options"] == [
        "customer_partnership_intros", "investor_intros", "hiring_referrals",
        "artgarage_facility", "iisc_labs_faculty", "non_dilutive_capital",
        "regulatory_policy", "advisor_time",
    ]


def test_financial_series_and_buckets():
    assert cat.FINANCIAL_SERIES["annual_revenue"] == [
        {"key": "annual_revenue_booked", "label": "Revenue: orders / paid pilots on books"},
        {"key": "annual_revenue_received", "label": "Revenue: payment received"},
    ]
    needs = [s["key"] for s in cat.FINANCIAL_SERIES["needs"]]
    assert needs == ["needs_total", "needs_confirmed", "needs_projected", "needs_gap"]
    assert len(cat.FINANCIAL_BUCKETS["needs"]) == 5


def test_headcount_categories_match_the_template():
    assert [c["key"] for c in cat.HEADCOUNT_CATEGORIES] == [
        "artpark_associated", "startup", "consultants", "interns"]


def test_carry_forward_rules_match_the_source():
    assert cat.CARRY_FORWARD["ip_assets"] == "all"
    assert cat.CARRY_FORWARD["funding"] == "all"
    assert cat.CARRY_FORWARD["products"] == "all"
    assert cat.CARRY_FORWARD["milestones"] == "open_only"
    assert cat.CARRY_FORWARD["collaborations"].startswith("buckets:")
    for s in ("risks", "asks", "publications", "planned_vs_actual", "next_milestones"):
        assert cat.CARRY_FORWARD[s] == "none", s


def test_lookups_fail_closed_on_an_unknown_key():
    """No silent default — a typo must raise, not return an empty schema."""
    with pytest.raises(KeyError):
        cat.entry_fields("nonsense")
    with pytest.raises(KeyError):
        cat.section("monthly", "nonsense")


# ── Fix round 1 findings ────────────────────────────────────────────────

def test_next_milestones_reachable_via_section_extra_entries():
    """Quarterly §9.2 ('next_milestones') has no SECTIONS row of its own —
    it hangs off 'planned_vs_actual' (§9.1). A renderer that only walks
    SECTIONS and pulls ENTRY_FIELDS[section["id"]] would silently drop the
    entire 'Top milestones for next quarter' table from the founder UI and
    from the report ARTPARK receives. SECTION_EXTRA_ENTRIES is the
    documented side-table that makes it reachable; this asserts that
    walking every SECTIONS row (both kinds) unioned with
    SECTION_EXTRA_ENTRIES yields exactly the full ENTRY_FIELDS key set —
    nothing missing, nothing orphaned."""
    reachable = set()
    for kind in cat.KINDS:
        for s in cat.SECTIONS[kind]:
            if s["type"] == "entries":
                reachable.add(s["id"])
                reachable.update(cat.SECTION_EXTRA_ENTRIES.get(s["id"], []))
    assert reachable == set(cat.ENTRY_FIELDS.keys())
    assert "next_milestones" in reachable


def test_annual_revenue_buckets_are_relative_to_the_fiscal_year():
    """§6.1's six buckets must never be a static list — they are computed
    relative to whichever FY a period falls in. Checked for two different
    fiscal years, one of them a century rollover."""
    assert cat.annual_revenue_buckets(2026) == [
        "FY22-23", "FY23-24", "FY24-25", "FY25-26", "FY26-27 YTD", "FY26-27 Proj",
    ]
    # Century-safe: FY99 rolls into FY00, not a literal "FY100".
    assert cat.annual_revenue_buckets(2099) == [
        "FY95-96", "FY96-97", "FY97-98", "FY98-99", "FY99-00 YTD", "FY99-00 Proj",
    ]


def test_annual_revenue_is_not_a_static_bucket_key():
    """No stale literal must be left under a name indistinguishable from
    ground truth — a caller must go through annual_revenue_buckets()."""
    assert "annual_revenue" not in cat.FINANCIAL_BUCKETS


def test_ask_category_options_have_human_readable_labels():
    cats = next(f for f in cat.ENTRY_FIELDS["asks"] if f["key"] == "category")
    labels = {o["value"]: o["label"] for o in cats["option_labels"]}
    assert labels["customer_partnership_intros"] == "Customer / partnership intros"
    assert labels["artgarage_facility"] == "ARTGarage / facility"
    assert labels["iisc_labs_faculty"] == "IISc labs / faculty"
    assert set(labels) == set(cats["options"])
