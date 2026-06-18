"""SIP profile-link fields (migration 025) parity with TIR.

Asserts resume_file_id / linkedin_url / github_url are writable + readable on
the SIP application models, so the /sip-applications PATCH accepts them and the
GET returns them (WRITABLE_FIELDS is derived from SipApplicationUpdate).
"""

import uuid

from app.models.sip_application import SipApplicationRead, SipApplicationUpdate
from app.routers.sip_applications import WRITABLE_FIELDS

PROFILE_LINK_FIELDS = ("resume_file_id", "linkedin_url", "github_url")


def test_profile_link_fields_on_update_model():
    for f in PROFILE_LINK_FIELDS:
        assert f in SipApplicationUpdate.model_fields, f


def test_profile_link_fields_on_read_model():
    for f in PROFILE_LINK_FIELDS:
        assert f in SipApplicationRead.model_fields, f


def test_profile_link_fields_are_writable():
    for f in PROFILE_LINK_FIELDS:
        assert f in WRITABLE_FIELDS, f


def test_update_accepts_and_coerces_profile_links():
    rid = uuid.uuid4()
    m = SipApplicationUpdate(
        resume_file_id=str(rid),
        linkedin_url="https://linkedin.com/in/test",
        github_url="https://github.com/test",
    )
    assert m.resume_file_id == rid
    assert m.linkedin_url == "https://linkedin.com/in/test"
    assert m.github_url == "https://github.com/test"


def test_update_allows_null_profile_links():
    m = SipApplicationUpdate(
        resume_file_id=None, linkedin_url=None, github_url=None
    )
    assert m.resume_file_id is None
    assert m.linkedin_url is None
    assert m.github_url is None
