import types
from app.services import profile_completion_service as svc


class _Resp:
    def __init__(self, data): self.data = data


class _Query:
    def __init__(self, table, store): self.t = table; self.store = store; self._rows=None; self._op=None; self._payload=None; self._filters={}
    def insert(self, row): self._op="insert"; self._payload=row; return self
    def update(self, row): self._op="update"; self._payload=row; return self
    def select(self, *a, **k): self._op="select"; return self
    def eq(self, c, v): self._filters[c]=v; return self
    def not_(self): return self
    def is_(self, c, v): self._filters[c]=("is", v); return self
    def limit(self, n): return self
    def maybe_single(self): self._single=True; return self
    def execute(self):
        if self._op=="insert":
            self.store.setdefault(self.t, []).append(self._payload)
            return _Resp([{**self._payload, "id": "row-1"}])
        if self._op=="update":
            self.store.setdefault(self.t+"_updates", []).append((dict(self._filters), self._payload))
            return _Resp([{"id":"row-1"}])
        rows=[r for r in self.store.get(self.t, []) if all(r.get(c)==v for c,v in self._filters.items() if not isinstance(v,tuple))]
        return _Resp(rows)


class FakeClient:
    def __init__(self, seed=None): self.store=dict(seed or {})
    def table(self, name): return _Query(name, self.store)


def test_create_token_inserts_row_and_returns_token():
    client=FakeClient()
    tok=svc.create_token(client, application_id="app-1", needs_resume=True, needs_linkedin=False, sent_to="a@b.com")
    rows=client.store["profile_completion_tokens"]
    assert len(rows)==1
    assert rows[0]["application_id"]=="app-1"
    assert rows[0]["needs_resume"] is True and rows[0]["needs_linkedin"] is False
    assert rows[0]["is_preview"] is False
    assert isinstance(tok, str) and len(tok) >= 20
    assert rows[0]["token"]==tok
    assert "expires_at" in rows[0]


def test_create_preview_token_has_null_app_and_preview_flag():
    client=FakeClient()
    svc.create_token(client, application_id=None, needs_resume=True, needs_linkedin=True, sent_to="me@x.com", is_preview=True)
    row=client.store["profile_completion_tokens"][0]
    assert row["application_id"] is None and row["is_preview"] is True


def test_token_state_valid_and_expired_and_used():
    from datetime import datetime, timezone, timedelta
    now=datetime.now(timezone.utc)
    good={"token":"t1","application_id":"app-1","needs_resume":True,"needs_linkedin":False,
          "is_preview":False,"used_at":None,"expires_at":(now+timedelta(hours=1)).isoformat()}
    assert svc.token_state(good)=="valid"
    assert svc.token_state({**good,"used_at":now.isoformat()})=="used"
    assert svc.token_state({**good,"expires_at":(now-timedelta(hours=1)).isoformat()})=="expired"


def test_compute_needs():
    assert svc.compute_needs({"resume_file_id":None,"linkedin_url":""})==(True,True)
    assert svc.compute_needs({"resume_file_id":"x","linkedin_url":"  "})==(False,True)
    assert svc.compute_needs({"resume_file_id":"x","linkedin_url":"http://li"})==(False,False)
