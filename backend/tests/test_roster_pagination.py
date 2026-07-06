from app.services import admin_query


class _RangeQuery:
    """Fake PostgREST builder: .range(start,end) slices a fixed row list, mimicking
    the ~1000-row cap (a caller must page to read them all)."""
    def __init__(self, rows):
        self._rows = rows
        self._s = 0
        self._e = None

    def range(self, start, end):
        self._s, self._e = start, end
        return self

    def execute(self):
        data = self._rows[self._s:self._e + 1]
        return type("Resp", (), {"data": data})()


def test_fetch_all_reads_beyond_one_page():
    rows = [{"i": i} for i in range(2400)]        # > 2 pages of 1000
    out = admin_query._fetch_all(lambda: _RangeQuery(rows), page=1000)
    assert len(out) == 2400
    assert out[0]["i"] == 0
    assert out[-1]["i"] == 2399


def test_fetch_all_exact_page_boundary_terminates():
    rows = [{"i": i} for i in range(1000)]        # exactly one full page
    out = admin_query._fetch_all(lambda: _RangeQuery(rows), page=1000)
    assert len(out) == 1000                        # second (empty) page stops the loop


def test_fetch_all_empty():
    out = admin_query._fetch_all(lambda: _RangeQuery([]), page=1000)
    assert out == []


def test_fetch_all_rebuilds_query_each_page():
    # Each page must use a FRESH builder (range() can't be safely reused).
    rows = [{"i": i} for i in range(1500)]
    built = {"n": 0}

    def make_query():
        built["n"] += 1
        return _RangeQuery(rows)

    out = admin_query._fetch_all(make_query, page=1000)
    assert len(out) == 1500
    assert built["n"] == 2        # page0 (1000) + page1 (500) => 2 builds
