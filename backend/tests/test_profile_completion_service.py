import types

import pytest

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


class _StorageBucket:
    def __init__(self, name, uploads): self.name = name; self._uploads = uploads
    def upload(self, path, file, file_options=None):
        self._uploads.append({"bucket": self.name, "path": path, "size": len(file), "options": file_options})
        return {"path": path}


class _Storage:
    def __init__(self, uploads): self._uploads = uploads
    def from_(self, bucket): return _StorageBucket(bucket, self._uploads)


class FakeClient:
    def __init__(self, seed=None):
        self.store=dict(seed or {})
        self.uploads=[]
        self.storage=_Storage(self.uploads)
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


def test_find_cohort_excludes_rejected_and_withdrawn():
    seeded = [
        {"id":"a","user_id":"u","status":"under_review","resume_file_id":None,"linkedin_url":None,"submitted_at":"t","display_seq":1,"basic_full_name":"A"},
        {"id":"b","user_id":"u","status":"rejected","resume_file_id":None,"linkedin_url":None,"submitted_at":"t","display_seq":2,"basic_full_name":"B"},
        {"id":"c","user_id":"u","status":"withdrawn","resume_file_id":None,"linkedin_url":None,"submitted_at":"t","display_seq":3,"basic_full_name":"C"},
        {"id":"d","user_id":"u","status":"under_review","resume_file_id":"x","linkedin_url":"http://li","submitted_at":"t","display_seq":4,"basic_full_name":"D"},
    ]
    class _Q:
        def select(self,*a,**k): return self
        @property
        def not_(self): return self
        def is_(self,*a,**k): return self
        def execute(self): return type("R",(),{"data": seeded})()
    class _C:
        def table(self,n): return _Q()
    out = svc.find_cohort(_C())
    # b(rejected)+c(withdrawn) excluded by status; d excluded (has both) → only a
    assert [r["id"] for r in out] == ["a"]
    assert out[0]["needs_resume"] is True and out[0]["needs_linkedin"] is True


def test_create_token_persists_needs_evidence():
    client = FakeClient()
    svc.create_token(client, application_id="app-1", needs_resume=False,
                      needs_linkedin=False, needs_evidence=True, sent_to="x@x.com")
    row = client.store["profile_completion_tokens"][0]
    assert row["needs_evidence"] is True


def test_store_evidence_prunes_dead_keeps_live_appends_new():
    # existing evidence_files: one live (A), one dead (B). exists_fn marks B missing.
    client = FakeClient({"tir_applications": [{
        "id": "app-1", "user_id": "u-1",
        "evidence_files": [
            {"file_uuid": "A", "path": "u-1/evidence/A.pdf", "name": "a.pdf", "size": 1, "mime": "application/pdf", "uploaded_at": "t"},
            {"file_uuid": "B", "path": "u-1/evidence/B.pdf", "name": "b.pdf", "size": 1, "mime": "application/pdf", "uploaded_at": "t"},
        ]}]})
    exists = lambda bucket, path: path != "u-1/evidence/B.pdf"   # B is dead
    out = svc.store_evidence_submission(
        client, application_id="app-1", owner_user_id="u-1",
        files=[{"bytes": b"x", "filename": "new.jpg", "mime": "image/jpeg"}],
        exists_fn=exists)
    _, payload = client.store["tir_applications_updates"][-1]
    saved = payload["evidence_files"]
    uuids = {e["file_uuid"] for e in saved}
    assert "A" in uuids and "B" not in uuids           # live kept, dead pruned
    assert any(e["path"].endswith(".jpg") for e in saved)  # new appended
    assert out == {"added": 1, "pruned": 1, "kept": 1}


def test_store_evidence_rejects_bad_mime():
    client = FakeClient({"tir_applications": [{"id": "app-1", "user_id": "u-1", "evidence_files": []}]})
    with pytest.raises(ValueError):
        svc.store_evidence_submission(
            client, application_id="app-1", owner_user_id="u-1",
            files=[{"bytes": b"x", "filename": "x.exe", "mime": "application/x-msdownload"}],
            exists_fn=lambda *_: True)


def test_store_evidence_default_exists_fn_no_arity_error():
    # Regression: with the DEFAULT exists_fn (client-bound _bytes_exist), the prune loop
    # must not raise. Prod 500'd because the loop calls exists_fn(bucket, path) but the
    # default _bytes_exist takes (client, bucket, path). The FakeClient has no
    # create_signed_url, so _bytes_exist's own try/except returns True (entry kept) —
    # the point of this test is that the call completes with NO TypeError.
    client = FakeClient({"tir_applications": [{
        "id": "app-1", "user_id": "u-1",
        "evidence_files": [
            {"file_uuid": "A", "path": "u-1/evidence/A.pdf", "name": "a.pdf", "size": 1, "mime": "application/pdf", "uploaded_at": "t"},
        ]}]})
    out = svc.store_evidence_submission(   # no exists_fn -> exercises the real default path
        client, application_id="app-1", owner_user_id="u-1",
        files=[{"bytes": b"x", "filename": "new.jpg", "mime": "image/jpeg"}])
    assert out["added"] == 1
    assert set(out) == {"added", "pruned", "kept"}
    _, payload = client.store["tir_applications_updates"][-1]
    assert any(e["path"].endswith(".jpg") for e in payload["evidence_files"])  # new appended
