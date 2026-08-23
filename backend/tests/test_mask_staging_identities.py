"""Unit tests for the staging identity masker. Pure functions only — no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from mask_staging_identities import fake_identity, is_exempt, mask_row  # noqa: E402


class TestDeterminism:
    def test_same_input_gives_same_identity(self):
        a = fake_identity("Krishna Koravadi")
        b = fake_identity("Krishna Koravadi")
        assert a == b

    def test_different_inputs_usually_differ(self):
        names = {fake_identity(f"Person {i}")["name"] for i in range(40)}
        # A hash-indexed pool will collide sometimes; it must not collapse to one.
        assert len(names) > 10

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
