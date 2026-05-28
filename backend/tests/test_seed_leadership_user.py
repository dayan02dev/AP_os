from scripts.seed_leadership_user import reconcile_roles


def test_reconcile_adds_leadership_and_drops_applicant():
    existing = ["applicant"]
    to_insert, to_delete = reconcile_roles(existing)
    assert to_insert == ["leadership"]
    assert to_delete == ["applicant"]


def test_reconcile_idempotent_when_already_leadership_only():
    to_insert, to_delete = reconcile_roles(["leadership"])
    assert to_insert == []
    assert to_delete == []


def test_reconcile_keeps_leadership_drops_applicant_when_both():
    to_insert, to_delete = reconcile_roles(["applicant", "leadership"])
    assert to_insert == []
    assert to_delete == ["applicant"]


def test_reconcile_empty_existing_inserts_leadership_only():
    to_insert, to_delete = reconcile_roles([])
    assert to_insert == ["leadership"]
    assert to_delete == []
