"""Tests for academic-roster profile enrichment.

The two things that must not be wrong here:
  1. The SSRF guard. POST /enrich takes a URL from the client and fetches it
     from inside Lambda. Only exact members of the roster allow-list may be
     fetched, and a redirect must not be able to walk us off that list (e.g. to
     169.254.169.254 to lift the function's credentials).
  2. The normaliser. The model's output is rendered straight onto an admin page,
     so a malformed or hostile response must degrade to empty fields rather than
     render junk or blow up the page.
"""

from __future__ import annotations

import json

import pytest
from app.deps import get_current_user
from app.main import app
from app.services.academic_enrichment import fetch as fetch_mod
from app.services.academic_enrichment import run as run_mod
from app.services.academic_enrichment.fetch import FetchError
from fastapi.testclient import TestClient

from tests.fixtures.fake_supabase import FakeSupabase

ALLOWED = "https://csa.iisc.ac.in/~barman/"
OTHER_ALLOWED = "https://biochem.iisc.ac.in/payel.php"
NOT_ALLOWED = "http://169.254.169.254/latest/meta-data/iam/security-credentials/"


@pytest.fixture(autouse=True)
def _allowlist(monkeypatch):
    """Pin a tiny allow-list instead of the real 744-URL file."""
    monkeypatch.setattr(fetch_mod, "allowed_urls",
                        lambda: frozenset({ALLOWED, OTHER_ALLOWED}))
    yield


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _user(roles):
    def _f():
        return {"user_id": "admin-1", "email": "admin@artpark.in", "roles": roles, "track": None}
    return _f


def _install(monkeypatch, tables=None):
    from app.routers import academic_profiles as router_mod

    fake = FakeSupabase(tables or {"academic_profiles": []})
    monkeypatch.setattr(router_mod, "get_admin_client", lambda: fake)
    return fake


def _client():
    return TestClient(app)


# ── 1. Allow-list / SSRF guard ─────────────────────────────────────────────

def test_is_allowed_is_exact_match_not_host_match():
    assert fetch_mod.is_allowed(ALLOWED)
    assert not fetch_mod.is_allowed(NOT_ALLOWED)
    # Same host, different path → still refused. A host allow-list would pass
    # this; we deliberately do not use one.
    assert not fetch_mod.is_allowed("https://csa.iisc.ac.in/~barman/../../etc/passwd")
    assert not fetch_mod.is_allowed("https://csa.iisc.ac.in/other-person/")
    assert not fetch_mod.is_allowed("")
    assert not fetch_mod.is_allowed(None)


def test_fetch_html_refuses_a_url_outside_the_roster():
    with pytest.raises(FetchError) as ei:
        fetch_mod.fetch_html(NOT_ALLOWED)
    assert ei.value.code == "url_not_in_roster"


def test_enrich_endpoint_422s_on_a_url_outside_the_roster(monkeypatch, _clear_overrides):
    fake = _install(monkeypatch)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": NOT_ALLOWED})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "url_not_in_roster"
    # Nothing was recorded, and crucially nothing was fetched.
    assert fake.tables["academic_profiles"] == []


def test_redirect_off_the_allowlist_is_blocked(monkeypatch):
    """A third-party page 302-ing at the metadata service must not be followed."""
    class _Resp:
        status_code = 302
        headers = {"location": NOT_ALLOWED}
        url = ALLOWED
        content = b""
        encoding = "utf-8"

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return _Resp()

    monkeypatch.setattr(fetch_mod.httpx, "Client", _Client)
    with pytest.raises(FetchError) as ei:
        fetch_mod.fetch_html(ALLOWED)
    assert ei.value.code == "redirect_blocked"


@pytest.mark.parametrize("target,allowed,why", [
    ("https://www.csa.iisc.ac.in/~barman/", True, "www canonicalisation of a roster host"),
    ("https://csa.iisc.ac.in/anything-else", True, "same roster host, other path"),
    ("http://169.254.169.254/latest/meta-data/", False, "AWS metadata service"),
    ("http://127.0.0.1:8000/admin", False, "loopback"),
    ("http://[::1]/", False, "ipv6 loopback"),
    ("http://10.0.0.5/internal", False, "private range"),
    ("https://evil.example.com/", False, "host not in the roster"),
    ("https://user:pw@csa.iisc.ac.in/", False, "credentials in the URL"),
    ("file:///etc/passwd", False, "non-http scheme"),
    ("gopher://x/", False, "non-http scheme"),
    ("", False, "empty"),
])
def test_redirect_ok_guard(monkeypatch, target, allowed, why):
    """The hop is host-scoped, not exact-URL, because real redirects here are
    canonicalisations — but it must still refuse every SSRF pivot."""
    fetch_mod.allowed_hosts.cache_clear()
    assert fetch_mod.redirect_ok(target) is allowed, why
    fetch_mod.allowed_hosts.cache_clear()


def test_allowed_hosts_covers_both_www_forms(monkeypatch):
    fetch_mod.allowed_hosts.cache_clear()
    hosts = fetch_mod.allowed_hosts()
    assert "csa.iisc.ac.in" in hosts
    assert "www.csa.iisc.ac.in" in hosts
    fetch_mod.allowed_hosts.cache_clear()


def test_a_second_redirect_is_refused(monkeypatch):
    class _Resp:
        def __init__(self, loc):
            self.status_code = 301
            self.headers = {"location": loc}
            self.url = ALLOWED
            self.content = b""
            self.encoding = "utf-8"

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return _Resp(OTHER_ALLOWED)

    fetch_mod.allowed_hosts.cache_clear()
    monkeypatch.setattr(fetch_mod.httpx, "Client", _Client)
    with pytest.raises(FetchError) as ei:
        fetch_mod.fetch_html(ALLOWED)
    assert ei.value.code == "too_many_redirects"
    fetch_mod.allowed_hosts.cache_clear()


def test_relative_redirect_locations_resolve(monkeypatch):
    seen = []

    class _Resp:
        def __init__(self, status, loc=None, body=b""):
            self.status_code = status
            self.headers = {"location": loc} if loc else {}
            self.url = ALLOWED
            self.content = body
            self.encoding = "utf-8"

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, **k):
            seen.append(url)
            return _Resp(302, loc="/elsewhere/") if len(seen) == 1 else _Resp(200, body=b"<p>hi</p>")

    fetch_mod.allowed_hosts.cache_clear()
    monkeypatch.setattr(fetch_mod.httpx, "Client", _Client)
    html, status = fetch_mod.fetch_html(ALLOWED)
    assert status == 200
    # Resolved against the original URL rather than string-concatenated.
    assert seen[1] == "https://csa.iisc.ac.in/elsewhere/"
    fetch_mod.allowed_hosts.cache_clear()


def test_redirect_to_another_allowlisted_url_is_followed(monkeypatch):
    calls = []

    class _Resp:
        def __init__(self, status, body=b"", loc=None):
            self.status_code = status
            self.headers = {"location": loc} if loc else {}
            self.url = ALLOWED
            self.content = body
            self.encoding = "utf-8"

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, url, **k):
            calls.append(url)
            if len(calls) == 1:
                return _Resp(301, loc=OTHER_ALLOWED)
            return _Resp(200, b"<html><body>hello</body></html>")

    monkeypatch.setattr(fetch_mod.httpx, "Client", _Client)
    html, status = fetch_mod.fetch_html(ALLOWED)
    assert status == 200
    assert "hello" in html
    assert calls == [ALLOWED, OTHER_ALLOWED]


def test_http_error_and_timeout_map_to_codes(monkeypatch):
    class _Resp:
        status_code = 404
        headers = {}
        url = ALLOWED
        content = b""
        encoding = "utf-8"

    class _Client:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): return _Resp()

    monkeypatch.setattr(fetch_mod.httpx, "Client", _Client)
    with pytest.raises(FetchError) as ei:
        fetch_mod.fetch_html(ALLOWED)
    assert ei.value.code == "page_unavailable"
    assert ei.value.http_status == 404

    class _Boom:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **k): raise fetch_mod.httpx.TimeoutException("slow")

    monkeypatch.setattr(fetch_mod.httpx, "Client", _Boom)
    with pytest.raises(FetchError) as ei:
        fetch_mod.fetch_html(ALLOWED)
    assert ei.value.code == "page_timeout"


# ── 2. HTML → text ─────────────────────────────────────────────────────────

def test_html_to_text_strips_chrome_and_keeps_mailto_and_links():
    html = """
    <head><title>x</title></head>
    <script>var evil = 1;</script>
    <style>.a{color:red}</style>
    <body>
      <h1>Prof Someone</h1>
      <p>Works on&nbsp;robotics &amp; control.</p>
      <a href="mailto:someone@iisc.ac.in">write</a>
      <a href="https://scholar.google.com/x">scholar</a>
    </body>"""
    text = fetch_mod.html_to_text(html)
    assert "evil" not in text
    assert "color:red" not in text
    assert "Prof Someone" in text
    assert "robotics & control" in text
    assert "mailto:someone@iisc.ac.in" in text
    assert "https://scholar.google.com/x" in text


def test_html_to_text_strips_comments():
    """Several departmental pages carry commented-out markup; tag-stripping
    alone leaves a trail of bare '-->' in what the model reads."""
    text = fetch_mod.html_to_text("<p>Real text</p><!-- Chaya Ganesh --><p>More</p>")
    assert "-->" not in text
    assert "Real text" in text and "More" in text
    # A whole commented block disappears, contents included.
    assert "hidden" not in fetch_mod.html_to_text("<!-- <p>hidden</p> -->")


def test_html_to_text_is_bounded_and_null_safe():
    assert fetch_mod.html_to_text("") == ""
    assert fetch_mod.html_to_text(None) == ""
    assert len(fetch_mod.html_to_text("<p>" + ("x" * 50_000) + "</p>")) <= 14_000


# ── 3. Normaliser ──────────────────────────────────────────────────────────

def test_normalise_shapes_a_good_response():
    out = run_mod.normalise({
        "emails": ["mailto:A@iisc.ac.in", "a@iisc.ac.in"],   # dupe + mailto
        "phone": "  +91 80 1234  ",
        "position": "Associate Professor",
        "lab": {"name": "Algo Lab", "url": "https://csa.iisc.ac.in/lab"},
        "education": ["PhD, Caltech, 2011", "PhD, Caltech, 2011"],
        "research_interests": ["fair division", "mechanism design"],
        "publications": [{"title": "A paper", "venue": "SODA", "year": "2019"}],
        "awards": ["Best Paper"],
        "links": [{"label": "Scholar", "url": "https://scholar.google.com/x"}],
        "summary": "Works on algorithms.",
    })
    assert out["emails"] == ["A@iisc.ac.in"]          # deduped case-insensitively
    assert out["phone"] == "+91 80 1234"
    assert out["lab"] == {"name": "Algo Lab", "url": "https://csa.iisc.ac.in/lab"}
    assert out["education"] == ["PhD, Caltech, 2011"]
    assert out["publications"] == [{"title": "A paper", "venue": "SODA", "year": "2019"}]
    assert out["links"] == [{"label": "Scholar", "url": "https://scholar.google.com/x"}]


def test_normalise_survives_garbage_without_raising():
    for junk in ({}, {"emails": "not-a-list", "lab": 5, "publications": "nope",
                      "links": [{"no_url": 1}], "education": [None, 3]},
                 {"lab": None}, {"publications": [{"title": ""}]}):
        out = run_mod.normalise(junk)
        assert out["emails"] == []
        assert out["publications"] == []
        assert out["lab"]["name"] is None
        assert isinstance(out["education"], list)


def test_normalise_rejects_a_non_year_year_and_non_http_links():
    out = run_mod.normalise({
        "publications": [{"title": "T", "venue": "V", "year": "in press"}],
        "links": [{"label": "bad", "url": "javascript:alert(1)"},
                  {"label": "ok", "url": "https://x.example/y"}],
        "lab": {"name": "L", "url": "javascript:alert(1)"},
    })
    assert out["publications"][0]["year"] is None
    assert [link["url"] for link in out["links"]] == ["https://x.example/y"]
    assert out["lab"]["url"] is None


def test_normalise_deobfuscates_and_validates_emails():
    out = run_mod.normalise({"emails": ["name [at] iisc [dot] ac [dot] in", "not-an-email"]})
    assert out["emails"] == ["name@iisc.ac.in"]


def test_normalise_caps_publications_at_eight():
    out = run_mod.normalise({"publications": [{"title": f"P{i}"} for i in range(30)]})
    assert len(out["publications"]) == 8


def test_is_empty_distinguishes_nothing_from_something():
    assert run_mod.is_empty({})
    assert run_mod.is_empty(run_mod.normalise({}))
    assert not run_mod.is_empty(run_mod.normalise({"summary": "x"}))
    assert not run_mod.is_empty(run_mod.normalise({"emails": ["a@b.co"]}))


def test_parse_json_handles_a_fenced_response():
    assert run_mod._parse_json('```json\n{"summary":"x"}\n```') == {"summary": "x"}
    assert run_mod._parse_json("not json at all") == {}


# ── 4. Router ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("roles,expected", [
    (["admin"], 200), (["leadership"], 403), (["jury"], 403), ([], 403),
])
def test_rbac_is_admin_only(monkeypatch, _clear_overrides, roles, expected):
    _install(monkeypatch)
    app.dependency_overrides[get_current_user] = _user(roles)
    r = _client().get(f"/admin/platform/academic-profiles?profile_url={ALLOWED}")
    assert r.status_code == expected


def test_get_returns_null_for_an_unfetched_url(monkeypatch, _clear_overrides):
    _install(monkeypatch)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().get(f"/admin/platform/academic-profiles?profile_url={ALLOWED}")
    assert r.status_code == 200
    assert r.json() == {"profile": None, "enrichable": True}


def test_get_flags_a_url_that_cannot_be_enriched(monkeypatch, _clear_overrides):
    _install(monkeypatch)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().get(f"/admin/platform/academic-profiles?profile_url={NOT_ALLOWED}")
    assert r.json()["enrichable"] is False


def test_enrich_stores_the_extraction(monkeypatch, _clear_overrides):
    fake = _install(monkeypatch)
    monkeypatch.setattr(run_mod, "enrich", lambda url: {
        "extracted": run_mod.normalise({"summary": "Does algorithms.",
                                        "emails": ["b@iisc.ac.in"]}),
        "http_status": 200, "content_chars": 4200, "model": "google/gemini-2.5-flash",
    })
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED, "name": "S Barman"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["status"] == "done"
    assert body["profile"]["extracted"]["emails"] == ["b@iisc.ac.in"]
    assert body["empty"] is False
    row = fake.tables["academic_profiles"][0]
    assert row["profile_url"] == ALLOWED
    assert row["name"] == "S Barman"
    assert row["enriched_by"] == "admin-1"


def test_enrich_returns_the_cache_without_refetching(monkeypatch, _clear_overrides):
    _install(monkeypatch, {"academic_profiles": [{
        "id": "p1", "profile_url": ALLOWED, "name": "S B", "status": "done",
        "extracted": {"summary": "cached"}, "fetched_at": "2026-07-30T00:00:00Z",
    }]})
    called = []
    monkeypatch.setattr(run_mod, "enrich", lambda url: called.append(url))
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED})
    assert r.json()["cached"] is True
    assert r.json()["profile"]["extracted"]["summary"] == "cached"
    assert called == [], "a cached done row must not trigger another fetch"


def test_force_refetches_over_a_cached_row(monkeypatch, _clear_overrides):
    _install(monkeypatch, {"academic_profiles": [{
        "id": "p1", "profile_url": ALLOWED, "status": "done",
        "extracted": {"summary": "old"},
    }]})
    monkeypatch.setattr(run_mod, "enrich", lambda url: {
        "extracted": run_mod.normalise({"summary": "new"}),
        "http_status": 200, "content_chars": 10, "model": "m",
    })
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED, "force": True})
    assert r.json()["cached"] is False
    assert r.json()["profile"]["extracted"]["summary"] == "new"


def test_a_fetch_failure_is_recorded_as_failed_not_raised(monkeypatch, _clear_overrides):
    """A dead page must come back as a 200 carrying status=failed — a bare 500
    would reach the browser without CORS headers and read as 'Failed to fetch'."""
    fake = _install(monkeypatch)

    def _boom(url):
        raise FetchError("page_timeout", "The profile page took too long to respond.")

    monkeypatch.setattr(run_mod, "enrich", _boom)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED})
    assert r.status_code == 200
    assert r.json()["profile"]["status"] == "failed"
    assert r.json()["profile"]["error_code"] == "page_timeout"
    assert fake.tables["academic_profiles"][0]["status"] == "failed"


def test_an_unexpected_exception_is_also_contained(monkeypatch, _clear_overrides):
    _install(monkeypatch)

    def _boom(url):
        raise ZeroDivisionError("surprise")

    monkeypatch.setattr(run_mod, "enrich", _boom)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED})
    assert r.status_code == 200
    assert r.json()["profile"]["error_code"] == "unexpected"


def test_enrich_rejects_unknown_body_fields(monkeypatch, _clear_overrides):
    _install(monkeypatch)
    app.dependency_overrides[get_current_user] = _user(["admin"])
    r = _client().post("/admin/platform/academic-profiles/enrich",
                       json={"profile_url": ALLOWED, "surprise": 1})
    assert r.status_code == 422


# ── 5. The shipped allow-list file ─────────────────────────────────────────

def test_the_real_allowlist_file_is_present_and_sane():
    """The SAM bundle only ships backend/, so this file must exist under
    backend/ — and it must match the roster the frontend renders.

    Reads the file directly: the autouse fixture above has replaced
    ``allowed_urls`` with a stub, and this assertion is about the shipped data.
    """
    path = fetch_mod._ALLOWLIST_PATH
    assert path.exists(), f"missing {path} — run scripts/gen_academic_profile_urls.py"
    urls = json.loads(path.read_text())
    assert len(urls) > 700
    assert all(isinstance(u, str) and u.startswith(("http://", "https://")) for u in urls)
    assert len(set(urls)) == len(urls), "allow-list has duplicates"


def test_the_allowlist_matches_the_frontend_roster():
    """Drift here silently breaks enrichment for newly-scraped professors
    (422 url_not_in_roster), so it is worth a test rather than a comment."""
    roster = (fetch_mod._ALLOWLIST_PATH.parents[3]
              / "frontend" / "public" / "iisc_professors.json")
    if not roster.exists():           # backend-only checkout
        pytest.skip("frontend roster not present in this checkout")
    from_roster = {(r.get("profile_url") or "").strip()
                   for r in json.loads(roster.read_text())}
    from_roster.discard("")
    allowed = set(json.loads(fetch_mod._ALLOWLIST_PATH.read_text()))
    missing = from_roster - allowed
    assert not missing, (
        f"{len(missing)} roster URL(s) missing from the allow-list — "
        f"re-run scripts/gen_academic_profile_urls.py. First: {sorted(missing)[:3]}")
