"""Unit tests for the staging identity masker. Hermetic — no network.

The collision tests at the bottom drive `main()` against an in-memory fake
Supabase client that enforces `profiles.email`'s unique constraint, which is
the constraint that used to abort the first `--apply` partway through.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import mask_staging_identities as masker  # noqa: E402
from mask_staging_identities import fake_identity, is_exempt, mask_row  # noqa: E402


class TestDeterminism:
    def test_same_input_gives_same_identity(self):
        a = fake_identity("Krishna Koravadi")
        b = fake_identity("Krishna Koravadi")
        assert a == b

    def test_different_inputs_usually_differ(self):
        # At demo scale (~550 rows to mask) two different applicants landing on
        # the same synthetic name reads as a data bug, not a masking artefact.
        # 500 distinct inputs must yield a realistically low collision rate.
        names = {fake_identity(f"Person {i}")["name"] for i in range(500)}
        assert len(names) >= 450

    def test_identity_has_every_field(self):
        got = fake_identity("Someone Real")
        assert set(got) == {"name", "email", "phone", "org", "linkedin"}
        assert all(isinstance(v, str) and v for v in got.values())

    def test_email_is_not_a_real_domain(self):
        assert fake_identity("Someone Real")["email"].endswith("@artpark.test")


class TestExemption:
    def test_staff_domains_are_exempt(self):
        assert is_exempt("dev@artpark.in")
        assert is_exempt("tir.founder.test@artpark.info")
        assert is_exempt("seed-app-001@artpark.test")

    def test_real_applicants_are_not_exempt(self):
        assert not is_exempt("someone@gmail.com")
        assert not is_exempt("prof@pilani.bits-pilani.ac.in")

    def test_missing_email_is_not_exempt(self):
        # A row with no email still carries a real NAME that must be masked.
        assert not is_exempt(None)
        assert not is_exempt("")

    def test_exemption_is_case_insensitive(self):
        assert is_exempt("Dev@ARTPARK.in")


class TestMaskRow:
    def test_only_returns_columns_that_exist(self):
        row = {"basic_full_name": "Real Name", "basic_email": "r@gmail.com"}
        patch = mask_row(row, {"basic_full_name", "basic_email"})
        assert set(patch) <= {"basic_full_name", "basic_email"}

    def test_never_invents_a_column_the_table_lacks(self):
        row = {"basic_full_name": "Real Name"}
        patch = mask_row(row, {"basic_full_name"})
        assert "basic_org" not in patch

    def test_never_writes_a_column_the_columns_set_excludes(self):
        # `columns` is the LIVE table's real column set (from _columns_of),
        # not just "whatever keys this dict happens to carry". A row can carry
        # a key that the actual table doesn't have room for — that must never
        # end up in the patch, or an update() call 400s / writes garbage.
        row = {"basic_full_name": "Real Name", "basic_org": "Real Startup Inc"}
        patch = mask_row(row, {"basic_full_name"})  # basic_org deliberately excluded
        assert "basic_org" not in patch

    def test_exempt_row_returns_an_empty_patch(self):
        row = {"basic_full_name": "Staff", "basic_email": "dev@artpark.in"}
        assert mask_row(row, {"basic_full_name", "basic_email"}) == {}

    def test_masks_a_row_with_no_email_using_its_name_as_the_seed(self):
        row = {"basic_full_name": "Real Name", "basic_email": None}
        patch = mask_row(row, {"basic_full_name", "basic_email"})
        assert patch["basic_full_name"] != "Real Name"

    def test_teammates_json_is_rewritten_not_dropped(self):
        row = {
            "basic_full_name": "Real Name",
            "basic_teammates": [{"name": "Someone Else", "role": "CTO"}],
        }
        patch = mask_row(row, {"basic_full_name", "basic_teammates"})
        mates = patch["basic_teammates"]
        assert isinstance(mates, list) and len(mates) == 1
        assert mates[0]["name"] != "Someone Else"
        # The non-identifying field must survive — the demo needs real shape.
        assert mates[0]["role"] == "CTO"

    def test_empty_teammates_stays_empty_not_null(self):
        # `basic_teammates` is NOT NULL on some rows; never write null into it.
        row = {"basic_full_name": "N", "basic_teammates": []}
        patch = mask_row(row, {"basic_full_name", "basic_teammates"})
        assert patch["basic_teammates"] == []


class TestProfilesNaming:
    """`profiles` uses a different naming convention than the application
    tables (`full_name`/`email`/`phone`/`linkedin_url`, no `basic_*` prefix).
    This branch of FIELD_MAP is exercised by 256 real rows on staging that
    `/admin/users` renders — it needs its own coverage, not just the
    `basic_*` branch."""

    def test_masks_a_profiles_shaped_row(self):
        row = {
            "id": "abc-123",
            "full_name": "Real Person",
            "email": "real@gmail.com",
            "phone": "9999999999",
            "linkedin_url": "https://linkedin.com/in/realperson",
        }
        columns = {"id", "full_name", "email", "phone", "linkedin_url"}
        patch = mask_row(row, columns)
        assert patch["full_name"] != "Real Person"
        assert patch["email"].endswith("@artpark.test")
        assert patch["phone"] != "9999999999"
        assert patch["linkedin_url"] != "https://linkedin.com/in/realperson"

    def test_profiles_exemption_still_works(self):
        row = {
            "id": "abc-123",
            "full_name": "Staff Person",
            "email": "dev@artpark.in",
            "phone": "9999999999",
            "linkedin_url": "https://linkedin.com/in/staffperson",
        }
        columns = {"id", "full_name", "email", "phone", "linkedin_url"}
        assert mask_row(row, columns) == {}


# ─── C1: synthetic-email collisions ────────────────────────────────────────
#
# `public.profiles.email` is `text not null unique`
# (backend/migrations/001_initial_schema.sql:39). `fake_identity` draws from a
# 24 x 26 x 14 = 8,736-handle space, so masking a couple of hundred rows into
# it produces birthday collisions — three of them, between three pairs of
# DIFFERENT real people, on live staging today. With one `update()` per row
# and no error handling, the first `--apply` raised 23505 partway through
# `profiles` (the last table in TARGETS) and left real names and real email
# addresses in the rows it never reached.
#
# These seed pairs are chosen, not random: they are known to hash to the same
# synthetic handle. `test_the_fixture_really_does_force_a_collision` fails
# loudly if a future change to the name pool breaks that, so these tests can
# never silently stop testing anything.
_COLLIDING_PAIR = ("person-0004@example.test", "person-1745@example.test")
_COLLIDING_TRIPLE = (
    "person-0013@example.test", "person-0264@example.test", "person-3368@example.test",
)


class _FakeSelect:
    def __init__(self, table):
        self._table = table
        self._limit = None
        self._range = None

    def limit(self, n):
        self._limit = n
        return self

    def order(self, _column):
        self._ordered = True
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def execute(self):
        rows = sorted(self._table.rows, key=lambda r: str(r.get("id")))
        if self._range is not None:
            lo, hi = self._range
            rows = rows[lo:hi + 1]
        if self._limit is not None:
            rows = rows[:self._limit]
        return SimpleNamespace(data=[dict(r) for r in rows])


class _FakeUpdate:
    def __init__(self, table, patch):
        self._table = table
        self._patch = patch
        self._row_id = None

    def eq(self, _column, value):
        self._row_id = value
        return self

    def execute(self):
        rows = self._table.rows
        target = next(r for r in rows if r["id"] == self._row_id)
        if self._row_id in self._table.fail_ids:
            raise RuntimeError("simulated PostgREST failure on this row")
        new_email = self._patch.get("email")
        if self._table.unique_email and new_email:
            for other in rows:
                if other is target and other.get("email") == new_email:
                    continue
                if other is not target and (other.get("email") or "").lower() == new_email.lower():
                    raise RuntimeError(
                        'duplicate key value violates unique constraint '
                        '"profiles_email_key" (23505)'
                    )
        target.update(self._patch)
        self._table.updates.append((self._row_id, dict(self._patch)))
        return SimpleNamespace(data=[dict(target)])


class _FakeTable:
    def __init__(self, name, rows, *, unique_email=False, fail_ids=()):
        self.name = name
        self.rows = rows
        self.unique_email = unique_email
        self.fail_ids = set(fail_ids)
        self.updates = []

    def select(self, _columns, **_kw):
        return _FakeSelect(self)

    def update(self, patch):
        return _FakeUpdate(self, patch)


class _FakeClient:
    """Just enough of the supabase-py surface for `main()`: `_columns_of`'s
    `select("*").limit(1)`, `_fetch_all`'s `select(...).order().range()`, and
    `update(...).eq("id", ...)`."""

    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return self._tables[name]


def _profiles_rows():
    """One `profiles` fixture exercising every branch that matters:
      * two rows whose seeds collide with each other (the pair),
      * three rows whose seeds all collide on one handle (the triple),
      * a staff row that must be left alone,
      * a row already masked by an earlier run, whose synthetic address must
        count as occupied even though the row itself is now exempt.
    """
    already_taken = fake_identity("person-9999@example.test")["email"]
    rows = []
    for i, seed in enumerate(_COLLIDING_PAIR + _COLLIDING_TRIPLE + ("person-9999@example.test",)):
        rows.append({
            "id": f"row-{i:02d}", "email": seed, "full_name": f"Real Person {i}",
            "phone": "9999999999", "linkedin_url": "https://linkedin.com/in/real",
        })
    rows.append({
        "id": "row-90", "email": "staff@artpark.in", "full_name": "Staff Person",
        "phone": "8888888888", "linkedin_url": "https://linkedin.com/in/staff",
    })
    rows.append({
        "id": "row-91", "email": already_taken, "full_name": "Already Masked",
        "phone": "+919812345678", "linkedin_url": "https://www.linkedin.com/in/x",
    })
    return rows


def _run_main(monkeypatch, profiles, *, apply_, fail_ids=()):
    tables = {
        "tir_applications": _FakeTable("tir_applications", []),
        "sip_applications": _FakeTable("sip_applications", []),
        "profiles": _FakeTable("profiles", profiles, unique_email=True, fail_ids=fail_ids),
    }
    client = _FakeClient(tables)
    monkeypatch.setenv("SUPABASE_URL", f"https://{masker.STAGING_PROJECT_ID}.supabase.co")
    monkeypatch.setattr("app.supabase_client.get_admin_client", lambda: client, raising=False)
    argv = ["mask_staging_identities.py"] + (["--apply"] if apply_ else [])
    monkeypatch.setattr(sys, "argv", argv)
    rc = masker.main()
    return rc, tables


class TestCollisionFixture:
    def test_the_fixture_really_does_force_a_collision(self):
        # If the name pool ever changes, these seeds may stop colliding — in
        # which case every test below would pass for the wrong reason. Fail
        # here instead, loudly, with instructions.
        pair = {fake_identity(s)["email"] for s in _COLLIDING_PAIR}
        triple = {fake_identity(s)["email"] for s in _COLLIDING_TRIPLE}
        assert len(pair) == 1, (
            "_COLLIDING_PAIR no longer collides — the FIRST/MIDDLE/LAST pools "
            "changed. Pick new colliding seeds before trusting these tests."
        )
        assert len(triple) == 1, (
            "_COLLIDING_TRIPLE no longer collides — pick new seeds."
        )

    def test_naive_per_row_masking_is_what_produced_the_duplicate(self):
        # Documents the defect, not the fix: masking row by row (which is what
        # main() used to do) hands different real people the same synthetic
        # email. profiles.email is unique, so the second write 23505s.
        columns = {"id", "email", "full_name", "phone", "linkedin_url"}
        naive = [mask_row(r, columns)["email"] for r in _profiles_rows()[:5]]
        assert len(set(naive)) < len(naive)


class TestCollisionFreePlanning:
    def test_every_planned_synthetic_email_is_unique(self):
        rows = _profiles_rows()
        columns = {"id", "email", "full_name", "phone", "linkedin_url"}
        plans, counts, _seeds = masker.build_plan({"profiles": (rows, columns)})
        emails = [p["email"] for _, p in plans["profiles"]]
        # The staff row is skipped; the already-masked row is skipped too.
        assert len(emails) == 6
        assert len(set(emails)) == len(emails), f"duplicate synthetic emails: {emails}"
        # 1 loser in the pair + 2 losers in the triple + 1 forced off the
        # address an earlier partial run already occupies.
        assert counts["profiles"] == 4

    def test_an_address_left_by_an_earlier_partial_run_counts_as_taken(self):
        rows = _profiles_rows()
        columns = {"id", "email", "full_name", "phone", "linkedin_url"}
        plans, _counts, _seeds = masker.build_plan({"profiles": (rows, columns)})
        occupied = next(r["email"] for r in rows if r["id"] == "row-91")
        assert occupied not in {p["email"] for _, p in plans["profiles"]}

    def test_planning_is_deterministic_and_order_independent(self):
        columns = {"id", "email", "full_name", "phone", "linkedin_url"}
        forward = masker.build_plan({"profiles": (_profiles_rows(), columns)})[0]
        backward = masker.build_plan(
            {"profiles": (list(reversed(_profiles_rows())), columns)},
        )[0]
        assert forward["profiles"] == backward["profiles"]

    def test_one_seed_gets_one_identity_in_every_table(self):
        # 191 seeds appear in both `profiles` and `tir_applications` on
        # staging; resolution spans the tables so those people do not end up
        # as two different stand-ins.
        seed = "shared-person@example.test"
        prof = [{"id": "p1", "email": seed, "full_name": "R"}]
        apps = [{"id": "a1", "basic_email": seed, "basic_full_name": "R"}]
        plans, _counts, _seeds = masker.build_plan({
            "profiles": (prof, {"id", "email", "full_name"}),
            "tir_applications": (apps, {"id", "basic_email", "basic_full_name"}),
        })
        assert plans["profiles"][0][1]["email"] == plans["tir_applications"][0][1]["basic_email"]
        assert plans["profiles"][0][1]["full_name"] == plans["tir_applications"][0][1]["basic_full_name"]

    def test_two_rows_for_the_same_person_keep_one_identity(self):
        seed = "same-person@example.test"
        apps = [
            {"id": "a1", "basic_email": seed, "basic_full_name": "R"},
            {"id": "a2", "basic_email": seed, "basic_full_name": "R"},
        ]
        plans, counts, _seeds = masker.build_plan(
            {"tir_applications": (apps, {"id", "basic_email", "basic_full_name"})},
        )
        got = [p["basic_email"] for _, p in plans["tir_applications"]]
        assert got[0] == got[1], "the same real person must not become two stand-ins"
        assert counts["tir_applications"] == 0


class TestApplyPath:
    def test_apply_writes_every_row_without_a_unique_violation(self, monkeypatch):
        rows = _profiles_rows()
        rc, tables = _run_main(monkeypatch, rows, apply_=True)
        assert rc == 0
        assert len(tables["profiles"].updates) == 6
        emails = [r["email"] for r in tables["profiles"].rows]
        assert len(set(emails)) == len(emails)
        # The staff row is untouched, real name and all.
        staff = next(r for r in rows if r["id"] == "row-90")
        assert staff["email"] == "staff@artpark.in"
        assert staff["full_name"] == "Staff Person"

    def test_a_failing_row_does_not_stop_the_rest(self, monkeypatch, caplog):
        rows = _profiles_rows()
        with caplog.at_level("ERROR"):
            rc, tables = _run_main(monkeypatch, rows, apply_=True, fail_ids=["row-01"])
        assert rc == 0
        # 6 planned, 1 forced to fail, 5 written — the run did NOT abort.
        assert len(tables["profiles"].updates) == 5
        messages = [r.getMessage() for r in caplog.records]
        assert any("FAILED to mask" in m for m in messages), messages
        assert any("could not be masked" in m for m in messages), messages

    def test_dry_run_reports_the_resalt_count_and_writes_nothing(self, monkeypatch, caplog):
        rows = _profiles_rows()
        with caplog.at_level("INFO"):
            rc, tables = _run_main(monkeypatch, rows, apply_=False)
        assert rc == 0
        assert tables["profiles"].updates == []
        messages = [r.getMessage() for r in caplog.records]
        assert any("4 re-salted" in m for m in messages), messages
        assert any("4 row(s) across 4 distinct identities re-salted" in m
                   for m in messages), messages

    def test_refuses_to_run_against_production(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_URL", f"https://{masker.PROD_PROJECT_ID}.supabase.co")
        monkeypatch.setattr(sys, "argv", ["mask_staging_identities.py", "--apply"])
        with pytest.raises(SystemExit) as exc:
            masker.main()
        assert exc.value.code == 2
