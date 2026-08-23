"""Unit tests for the demo cohort planner. Pure functions only — no network."""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import seed_demo_cohort as seed  # noqa: E402
from seed_demo_cohort import (  # noqa: E402
    DEMO_PLAN,
    PINNED_APPLICATION_IDS,
    reviews_for,
    select_demo_rows,
)


class TestPlanShape:
    def test_twelve_slots(self):
        assert len(DEMO_PLAN) == 12

    def test_every_slot_names_a_track_and_status(self):
        for p in DEMO_PLAN:
            assert p["track"] in ("tir", "sip")
            assert p["status"]

    def test_covers_the_states_the_spec_requires(self):
        statuses = {p["status"] for p in DEMO_PLAN}
        for required in ("submitted", "under_review", "evaluated",
                         "on_hold", "jury_review", "rejected", "offered"):
            assert required in statuses, f"{required} missing from the demo plan"

    def test_exactly_one_slot_is_a_moved_track(self):
        assert sum(1 for p in DEMO_PLAN if p.get("moved")) == 1

    def test_exactly_one_slot_has_a_signed_memo(self):
        assert sum(1 for p in DEMO_PLAN if p.get("memo") == "signed") == 1

    def test_signed_memo_slot_is_visible_on_the_accepted_tab(self):
        # Ruling A (I5, 2026-08-24 review): it is not enough that exactly one
        # slot is signed — it has to be the RIGHT one. The Admin "Selected
        # Applications" tab only ever fetches status=jury_review plus
        # gate-2-rejected rows, and its green ACCEPTED row requires a signed
        # memo. A signed memo on any status other than jury_review (e.g.
        # "offered") could never render as that row anywhere in the demo.
        # This pins the property that actually matters, not just the count.
        signed = [p for p in DEMO_PLAN if p.get("memo") == "signed"]
        assert len(signed) == 1
        assert signed[0]["status"] == "jury_review", (
            "the signed-memo slot must be status=jury_review — that is the "
            "only status the Accepted tab's green ACCEPTED row can render "
            f"for, but this slot is {signed[0]['status']!r}"
        )


class TestSelection:
    def _cands(self, n):
        # Deliberately unsorted, to prove selection does not depend on input order.
        return [{"id": f"{i:04d}-aaaa", "status": "under_review"} for i in reversed(range(n))]

    def test_selects_one_row_per_slot(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        assert len(got) == len(DEMO_PLAN)

    def test_selection_is_stable_across_input_order(self):
        a = select_demo_rows(self._cands(30), DEMO_PLAN)
        b = select_demo_rows(list(reversed(self._cands(30))), DEMO_PLAN)
        assert [r["id"] for r, _ in a] == [r["id"] for r, _ in b]

    def test_never_reuses_a_row(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        ids = [r["id"] for r, _ in got]
        assert len(ids) == len(set(ids))

    def test_raises_when_there_are_too_few_candidates(self):
        import pytest
        with pytest.raises(ValueError, match="not enough"):
            select_demo_rows(self._cands(3), DEMO_PLAN)


class TestPinnedSelection:
    """NEW-1 (round 2, 2026-08-24 review): a second --apply must target the
    SAME twelve applications as the first, not silently drift. Slot 10
    writes status `offered`, which the live candidate pool excludes (C1) —
    so on a naive sorted-order-only re-run, slot 10's own application drops
    out of ITS OWN pool and every slot that sorts after it shifts onto a
    previously-untouched application. Pinning by id, resolved independently
    per slot, is what stops that. All fixtures here are in-memory dicts —
    no network, hermetic.
    """

    def _plan(self):
        return [
            {"slot": 1, "track": "tir", "status": "s1"},
            {"slot": 2, "track": "tir", "status": "s2"},
            {"slot": 3, "track": "tir", "status": "s3"},
            {"slot": 4, "track": "tir", "status": "s4"},
        ]

    def _pinned(self):
        return {1: "id-a", 2: "id-b", 3: "id-c", 4: "id-d"}

    def test_a_pinned_id_that_left_the_pool_is_a_hard_refusal(self):
        # I3 (round-3 review): this used to fall back to a sorted-order pick
        # and log a warning. That fallback WAS the bug — it wrote an
        # irreversible gate decision onto a previously-untouched application,
        # guarded only by a log line in the middle of a long run.
        plan = self._plan()
        pinned = self._pinned()

        pool_run1 = [{"id": i, "status": "under_review"}
                     for i in ("id-a", "id-b", "id-c", "id-d")]
        run1 = select_demo_rows(pool_run1, plan, pinned=pinned)
        assert [c["id"] for c, _ in run1] == ["id-a", "id-b", "id-c", "id-d"]

        # id-c (slot 3) is gone from the pool and a brand-new, untouched
        # application (id-z) has taken its place. Nothing must be selected.
        pool_run2 = [{"id": i, "status": "under_review"}
                     for i in ("id-a", "id-b", "id-d", "id-z")]
        with pytest.raises(seed.UnresolvablePinnedId) as exc:
            select_demo_rows(pool_run2, plan, pinned=pinned)
        assert exc.value.slot == 3
        assert exc.value.application_id == "id-c"
        assert "slot 3" in str(exc.value)
        assert "id-c" in str(exc.value)

    def test_a_slot_with_no_pin_at_all_still_falls_back(self, caplog):
        # A partial map must keep working: only a PRESENT-but-unresolvable pin
        # is a refusal. Slot 3 has no entry here.
        plan = self._plan()
        pinned = {1: "id-a", 2: "id-b", 4: "id-d"}
        pool = [{"id": i, "status": "under_review"}
                for i in ("id-a", "id-b", "id-d", "id-z")]
        with caplog.at_level("WARNING"):
            got = select_demo_rows(pool, plan, pinned=pinned)
        assert [c["id"] for c, _ in got] == ["id-a", "id-b", "id-z", "id-d"]
        assert any("slot 3" in r.getMessage() for r in caplog.records)

    def test_without_pinning_behaves_exactly_as_before(self):
        # Original callers never pass `pinned`; confirm the default (None)
        # still falls through to pure sorted-order selection.
        plan = self._plan()
        pool = [{"id": i, "status": "under_review"}
                for i in ("id-d", "id-c", "id-b", "id-a")]
        got = select_demo_rows(pool, plan)
        assert [c["id"] for c, _ in got] == ["id-a", "id-b", "id-c", "id-d"]


class TestReviewSets:
    def test_yes_verdict_needs_two_yes_and_under_two_no(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_yes")]
        assert recs.count("yes") >= 2 and recs.count("no") < 2

    def test_no_verdict_needs_two_no_and_under_two_yes(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_no")]
        assert recs.count("no") >= 2 and recs.count("yes") < 2

    def test_split_produces_neither_majority(self):
        recs = [r["recommendation"] for r in reviews_for("split")]
        assert recs.count("yes") < 2 and recs.count("no") < 2

    def test_none_means_no_reviews(self):
        assert reviews_for("none") == []

    def test_every_review_carries_submitted_at(self):
        # The live `reviews` table has NO `status` column — submitted_at is the
        # only signal that a review counts as submitted.
        for spec in ("verdict_yes", "verdict_no", "split"):
            for r in reviews_for(spec):
                assert r.get("submitted_at")
                assert "status" not in r


# ─── I3: the seed must be genuinely re-runnable ────────────────────────────

class _FakeSelect:
    """Enough of the PostgREST builder for `_fetch_all_apps` and the pinned-id
    pre-flight: neq / in_ / order / range."""

    def __init__(self, rows):
        self._rows = list(rows)
        self._slice = None

    def neq(self, column, value):
        self._rows = [r for r in self._rows if r.get(column) != value]
        return self

    def in_(self, column, values):
        wanted = set(values)
        self._rows = [r for r in self._rows if r.get(column) in wanted]
        return self

    def order(self, column):
        self._rows = sorted(self._rows, key=lambda r: str(r.get(column)))
        return self

    def range(self, lo, hi):
        self._slice = (lo, hi)
        return self

    def execute(self):
        rows = self._rows
        if self._slice is not None:
            lo, hi = self._slice
            rows = rows[lo:hi + 1]
        return SimpleNamespace(data=[dict(r) for r in rows])


class _FakeTable:
    def __init__(self, rows):
        self._rows = rows

    def select(self, _columns, **_kw):
        return _FakeSelect(self._rows)


class _FakeClient:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _FakeTable(self._tables.get(name, []))


def _plan_by_slot():
    return {p["slot"]: p for p in DEMO_PLAN}


def _staging_like_client(statuses):
    """A fake staging holding every pinned application at the given status,
    plus spare untouched candidates the old fallback would have grabbed."""
    plan = _plan_by_slot()
    tables = {"tir_applications": [], "sip_applications": []}
    for slot, app_id in PINNED_APPLICATION_IDS.items():
        table = "tir_applications" if plan[slot]["track"] == "tir" else "sip_applications"
        tables[table].append({
            "id": app_id, "status": statuses[slot],
            "basic_email": f"pinned-{slot}@example.test",
        })
    # Spare, previously-untouched applications. `zzz-*` sorts last so the old
    # sorted-order fallback would have picked one of them — which is exactly
    # the silent cohort growth this test exists to forbid.
    for i in range(4):
        tables["tir_applications"].append({
            "id": f"zzz-spare-{i}", "status": "under_review",
            "basic_email": f"spare-{i}@example.test",
        })
    tables["sip_applications"].append({
        "id": "zzz-spare-sip", "status": "submitted",
        "basic_email": "spare-sip@example.test",
    })
    # A draft must never be selected, whatever else changes.
    tables["tir_applications"].append({
        "id": "aaa-draft", "status": "draft", "basic_email": "draft@example.test",
    })
    return _FakeClient(tables)


def _resolve(client):
    tir_plan = [p for p in DEMO_PLAN if p["track"] == "tir"]
    sip_plan = [p for p in DEMO_PLAN if p["track"] == "sip"]
    pairs = (
        select_demo_rows(seed._fetch_all_apps(client, "tir"), tir_plan,
                         pinned=PINNED_APPLICATION_IDS)
        + select_demo_rows(seed._fetch_all_apps(client, "sip"), sip_plan,
                           pinned=PINNED_APPLICATION_IDS)
    )
    return {p["slot"]: str(c["id"]) for c, p in pairs}


class TestReRunStability:
    """I3 (round-3 review): pinning alone did NOT make the seed re-runnable.
    Slot 10 writes `offered` and `_EXCLUDED_STATUSES` excludes `offered`, so on
    the second `--apply` slot 10's own pinned id was missing from its own pool,
    the resolver fell back, and a previously-untouched thirteenth application
    was promoted to `offered` with a gate-2 decision. Every further run
    promoted one more.
    """

    def test_a_second_selection_returns_the_identical_twelve(self):
        plan = _plan_by_slot()
        # Run 1: everything sits at a pre-seed status.
        before = {slot: "under_review" for slot in PINNED_APPLICATION_IDS}
        run1 = _resolve(_staging_like_client(before))
        assert run1 == dict(PINNED_APPLICATION_IDS)

        # Run 2: every slot now holds the status the seed wrote — including
        # slot 10 at `offered`, which `_EXCLUDED_STATUSES` excludes.
        after = {slot: plan[slot]["status"] for slot in PINNED_APPLICATION_IDS}
        assert after[10] == "offered"
        run2 = _resolve(_staging_like_client(after))
        assert run2 == run1, (
            "the second selection drifted off the pinned cohort — slots that "
            f"changed: { {s: (run1[s], run2[s]) for s in run1 if run1[s] != run2[s]} }"
        )
        assert not any(v.startswith("zzz-spare") for v in run2.values())

    def test_a_pinned_row_moved_to_a_status_its_slot_never_writes_is_refused(self):
        # The exemption is deliberately narrow: it re-admits a pinned row only
        # when its current status is the one its own slot writes. Anything else
        # — someone onboarding a demo application, say — must refuse rather
        # than demote it.
        statuses = {slot: "under_review" for slot in PINNED_APPLICATION_IDS}
        statuses[3] = "onboarded"
        with pytest.raises(seed.UnresolvablePinnedId) as exc:
            _resolve(_staging_like_client(statuses))
        assert exc.value.slot == 3
        assert exc.value.application_id == PINNED_APPLICATION_IDS[3]

    def test_pinned_target_status_maps_ids_to_their_own_slots_status(self):
        plan = _plan_by_slot()
        tir = seed._pinned_target_status("tir")
        assert tir[PINNED_APPLICATION_IDS[10]] == "offered"
        assert tir[PINNED_APPLICATION_IDS[1]] == plan[1]["status"]
        # SIP pins never appear in the TIR map and vice versa.
        assert PINNED_APPLICATION_IDS[11] not in tir
        assert seed._pinned_target_status("sip") == {
            PINNED_APPLICATION_IDS[11]: plan[11]["status"],
        }

    def test_no_slot_targets_draft_so_drafts_can_never_be_re_admitted(self):
        assert "draft" not in {p["status"] for p in DEMO_PLAN}


class TestPinnedCohortShape:
    def test_every_slot_is_pinned_exactly_once(self):
        assert sorted(PINNED_APPLICATION_IDS) == [p["slot"] for p in DEMO_PLAN]
        assert len(set(PINNED_APPLICATION_IDS.values())) == len(PINNED_APPLICATION_IDS)


class TestExemptDomainMirror:
    """C2 (round-3 review): the guard that stops a pinned application sitting
    on a masker-exempt domain only works while the two lists agree. The masker
    is the source of truth; the seed carries a copy so it never depends on
    `scripts/` being importable as a package."""

    def test_the_copied_exempt_domain_list_matches_the_masker(self):
        from mask_staging_identities import EXEMPT_DOMAINS

        assert seed._MASKER_EXEMPT_DOMAINS == EXEMPT_DOMAINS, (
            "mask_staging_identities.EXEMPT_DOMAINS changed — update "
            "seed_demo_cohort._MASKER_EXEMPT_DOMAINS to match, or the "
            "pinned-id pre-flight silently stops covering the new domain."
        )

    def test_no_pinned_email_placeholder_in_the_repo_is_exempt(self):
        # Cheap belt-and-braces on the guard's own logic.
        from mask_staging_identities import is_exempt

        assert is_exempt("someone@artpark.in")
        assert not is_exempt("someone@gmail.com")


# ─── C2: the pinned-id / exempt-domain pre-flight ──────────────────────────

def _client_with_pinned_emails(emails):
    """A fake staging where every pinned application carries the given email.
    `emails` maps slot -> email (or None to omit the row entirely)."""
    plan = _plan_by_slot()
    tables = {"tir_applications": [], "sip_applications": []}
    for slot, app_id in PINNED_APPLICATION_IDS.items():
        email = emails.get(slot, f"applicant-{slot}@example.test")
        if email is None:
            continue
        table = "tir_applications" if plan[slot]["track"] == "tir" else "sip_applications"
        tables[table].append({"id": app_id, "basic_email": email})
    return _FakeClient(tables)


class TestPinnedIdsAreMaskable:
    """C2 (round-3 review): slot 11 was pinned to an application whose
    basic_email is on @artpark.in — a domain the masker EXEMPTS. That row kept
    its real name, email, phone and org, so the seed drove a real, named
    identity to `jury_review` (the exact row the handout points at) and wired a
    live mailbox to the Final Gate's Reject button, which resolves its
    recipient from basic_email. Re-pinning fixed the instance; this guard is
    what stops the class."""

    def test_accepts_a_cohort_that_is_entirely_maskable(self):
        assert seed._verify_pinned_ids_are_maskable(_client_with_pinned_emails({})) is True

    @pytest.mark.parametrize("domain", ["artpark.in", "artpark.info", "artpark.test"])
    def test_refuses_any_masker_exempt_domain(self, domain, caplog):
        client = _client_with_pinned_emails({11: f"someone@{domain}"})
        with caplog.at_level("ERROR"):
            assert seed._verify_pinned_ids_are_maskable(client) is False
        messages = " ".join(r.getMessage() for r in caplog.records)
        assert "slot 11" in messages
        assert domain in messages

    def test_the_refusal_explains_why(self, caplog):
        # Reproduces the shape of the shipped defect — a staff address on the
        # SIP slot — without writing a real address into this public repo.
        client = _client_with_pinned_emails({11: "some.staff.member@artpark.in"})
        with caplog.at_level("ERROR"):
            assert seed._verify_pinned_ids_are_maskable(client) is False
        messages = " ".join(r.getMessage() for r in caplog.records)
        assert "EXEMPTS" in messages
        assert "Re-pin slot 11" in messages
        # The message must name the domain, never echo the local part.
        assert "some.staff.member" not in messages

    def test_refuses_a_pinned_id_that_does_not_exist(self, caplog):
        client = _client_with_pinned_emails({4: None})
        with caplog.at_level("ERROR"):
            assert seed._verify_pinned_ids_are_maskable(client) is False
        assert any("does not exist" in r.getMessage() for r in caplog.records)

    def test_a_missing_email_is_a_warning_not_a_refusal(self, caplog):
        # No basic_email at all: the masker seeds from the name instead, so the
        # row IS masked. Worth flagging, not worth refusing.
        client = _client_with_pinned_emails({7: ""})
        with caplog.at_level("WARNING"):
            assert seed._verify_pinned_ids_are_maskable(client) is True
        assert any("no basic_email" in r.getMessage() for r in caplog.records)


# ─── admin_decisions CHECK pre-flight ──────────────────────────────────────

class _FakeDecisionTable:
    """`insert()` raises whatever `raiser` returns for a given decision value;
    `delete()` records the cleanup so the test can assert it happened."""

    def __init__(self, raiser):
        self._raiser = raiser
        self.inserted = []
        self.deleted = []

    def insert(self, rows):
        self._rows = rows
        return self

    def execute(self):
        exc = self._raiser(self._rows[0]["decision"])
        if exc is not None:
            raise exc
        self.inserted.append(self._rows[0])
        return SimpleNamespace(data=[dict(self._rows[0])])

    def delete(self):
        return self

    def eq(self, _column, value):
        self.deleted.append(value)
        return self


class _DecisionClient:
    def __init__(self, table):
        self._table = table

    def table(self, name):
        assert name == "admin_decisions"
        return self._table


def _duplicate_key(_value):
    return RuntimeError('duplicate key value violates unique constraint '
                        '"admin_decisions_pkey"')


class TestAdminDecisionCheckPreflight:
    """`_verify_schema` only checked column EXISTENCE, and `decision` exists in
    every version of the table — what changed across migrations 024/027/033 is
    the allowed VALUE list. Without this probe, a project missing 027 or 033
    step 2 raises 23514 on the first slot that writes the new value, AFTER the
    earlier slots are fully written."""

    def test_a_duplicate_key_means_the_check_accepted_the_value(self):
        table = _FakeDecisionTable(_duplicate_key)
        assert seed._verify_admin_decision_values(_DecisionClient(table)) is True
        assert table.inserted == []   # never actually wrote anything
        assert table.deleted == []    # and never needed to clean up

    def test_a_check_violation_on_decision_refuses(self, caplog):
        def raiser(value):
            if value == "offered":
                return RuntimeError(
                    'new row for relation "admin_decisions" violates check '
                    'constraint "admin_decisions_decision_check"'
                )
            return _duplicate_key(value)

        with caplog.at_level("ERROR"):
            ok = seed._verify_admin_decision_values(_DecisionClient(_FakeDecisionTable(raiser)))
        assert ok is False
        messages = " ".join(r.getMessage() for r in caplog.records)
        assert "REJECTS" in messages and "offered" in messages
        assert "033 step 2" in messages

    def test_an_unrecognized_error_refuses_rather_than_guessing(self, caplog):
        with caplog.at_level("ERROR"):
            ok = seed._verify_admin_decision_values(
                _DecisionClient(_FakeDecisionTable(lambda _v: RuntimeError("network went away"))),
            )
        assert ok is False
        assert any("unrecognized error" in r.getMessage() for r in caplog.records)

    def test_an_unexpected_insert_is_cleaned_up_and_refused(self, caplog):
        table = _FakeDecisionTable(lambda _v: None)   # nothing raises: row lands
        with caplog.at_level("ERROR"):
            assert seed._verify_admin_decision_values(_DecisionClient(table)) is False
        assert table.deleted, "the probe must delete a row it unexpectedly inserted"
        assert any("unexpectedly inserted" in r.getMessage() for r in caplog.records)

    def test_it_probes_every_value_the_script_actually_writes(self):
        table = _FakeDecisionTable(_duplicate_key)
        seen = []

        def raiser(value):
            seen.append(value)
            return _duplicate_key(value)

        table._raiser = raiser
        seed._verify_admin_decision_values(_DecisionClient(table))
        written = {seed._GATE1_GATES[g] for g in seed._GATE1_GATES}
        written |= {seed._GATE2_GATES[g] for g in seed._GATE2_GATES}
        assert set(seen) == written
        assert "offered" in seen and "jury_review" in seen
