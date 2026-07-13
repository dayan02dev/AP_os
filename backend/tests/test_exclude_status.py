from app.services.admin_query import _parse_exclude_status


def test_parses_comma_separated_string():
    assert _parse_exclude_status("rejected,jury_review") == {"rejected", "jury_review"}


def test_single_value_still_works():
    assert _parse_exclude_status("rejected") == {"rejected"}


def test_blank_and_none_yield_empty_set():
    assert _parse_exclude_status("") == set()
    assert _parse_exclude_status(None) == set()


def test_accepts_iterable():
    assert _parse_exclude_status(["rejected", "jury_review"]) == {"rejected", "jury_review"}
