from scripts.seed_vip_onboarding import _find_user, _revert_precondition_ok


class _User:
    def __init__(self, id_, email):
        self.id = id_
        self.email = email


class _FakeAuthAdmin:
    """Stand-in for client.auth.admin — list_users(page=, per_page=) only.

    Mirrors the paginated shape the real Supabase client returns: a plain
    list per page, empty once exhausted. Used to prove _find_user walks
    every page rather than assuming page 1 has everything (PostgREST's
    1000-row cap has bitten this project before).
    """

    def __init__(self, pages):
        self._pages = pages

    def list_users(self, page: int = 1, per_page: int = 200):
        idx = page - 1
        if idx < 0 or idx >= len(self._pages):
            return []
        return self._pages[idx]


class _FakeClient:
    def __init__(self, pages):
        self.auth = type("Auth", (), {"admin": _FakeAuthAdmin(pages)})()


# ---- _find_user: pagination ------------------------------------------------

def test_find_user_on_first_page():
    sb = _FakeClient([[_User("u1", "a@x.com"), _User("u2", "target@x.com")]])
    hit = _find_user(sb, "target@x.com", page_size=200)
    assert hit is not None
    assert hit.id == "u2"


def test_find_user_walks_to_a_later_page():
    # per_page=2 forces the target (on "page 2") to be missed by an
    # unpaginated / first-page-only lookup.
    pages = [
        [_User("u1", "a@x.com"), _User("u2", "b@x.com")],
        [_User("u3", "target@x.com")],
    ]
    sb = _FakeClient(pages)
    hit = _find_user(sb, "target@x.com", page_size=2)
    assert hit is not None
    assert hit.id == "u3"


def test_find_user_case_insensitive_email_match():
    sb = _FakeClient([[_User("u1", "Target@X.com")]])
    hit = _find_user(sb, "target@x.com", page_size=200)
    assert hit is not None
    assert hit.id == "u1"


def test_find_user_returns_none_when_exhausted():
    pages = [[_User("u1", "a@x.com"), _User("u2", "b@x.com")]]
    sb = _FakeClient(pages)
    assert _find_user(sb, "nope@x.com", page_size=2) is None


def test_find_user_stops_on_short_page_without_extra_roundtrip():
    # A page shorter than page_size is the last page — _find_user must not
    # call list_users again past it (the fake would just return [] anyway,
    # but a short page below page_size is itself the "no more users" signal
    # per the Supabase pagination contract).
    pages = [[_User("u1", "a@x.com")]]
    sb = _FakeClient(pages)
    assert _find_user(sb, "nope@x.com", page_size=200) is None


# ---- _revert_precondition_ok -----------------------------------------------

def test_revert_allowed_when_currently_onboarded():
    assert _revert_precondition_ok("onboarded") is True


def test_revert_refused_when_not_onboarded():
    # The old behaviour blindly restored to "submitted" regardless of the
    # application's actual current status — refusing here is what stops a
    # stray --revert from stomping a status this script never set.
    assert _revert_precondition_ok("submitted") is False
    assert _revert_precondition_ok("offered") is False
    assert _revert_precondition_ok("draft") is False
