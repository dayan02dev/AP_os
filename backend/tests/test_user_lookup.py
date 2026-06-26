from unittest.mock import MagicMock
from app.services.user_lookup import get_contact, get_admin_emails


def _sb_with_tables(table_data: dict):
    """Fake supabase client: table(name).select(...).eq(...).execute().data."""
    sb = MagicMock()
    def table(name):
        t = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=table_data.get(name, []))
        for m in ("select", "eq", "in_", "limit"):
            getattr(chain, m).return_value = chain
        t.select.return_value = chain
        return t
    sb.table.side_effect = table
    return sb


def test_get_contact_from_profiles():
    sb = _sb_with_tables({"profiles": [{"id": "u1", "email": "r@x.in", "full_name": "Rey"}]})
    assert get_contact(sb, "u1") == {"email": "r@x.in", "name": "Rey"}


def test_get_contact_missing_returns_none():
    sb = _sb_with_tables({"profiles": []})
    sb.auth.admin.get_user.side_effect = Exception("nope")
    assert get_contact(sb, "ghost") is None


def test_get_admin_emails_dedupes():
    sb = _sb_with_tables({
        "user_roles": [{"user_id": "a1"}, {"user_id": "a1"}, {"user_id": "a2"}],
        "profiles": [
            {"id": "a1", "email": "n@artpark.in", "full_name": "N"},
            {"id": "a2", "email": "m@artpark.in", "full_name": "M"},
        ],
    })
    emails = get_admin_emails(sb)
    assert sorted(emails) == ["m@artpark.in", "n@artpark.in"]
