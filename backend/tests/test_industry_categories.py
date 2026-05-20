"""Tests for backend/app/services/industry_categories.py.

Unit tier only — mocks Supabase via monkeypatch of get_admin_client.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import industry_categories


def _mock_client_with_categories(categories: list[dict]) -> MagicMock:
    """Build a chain-mock Supabase client whose
    `.table('industry_categories').select(...).order().order().execute()`
    returns the given `categories` list."""
    client = MagicMock()
    chain = client.table.return_value.select.return_value
    chain.order.return_value.order.return_value.execute.return_value = (
        SimpleNamespace(data=categories)
    )
    return client


def test_fetch_categories_returns_data(monkeypatch):
    rows = [
        {"id": "ai", "label": "AI", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
        {"id": "robotics", "label": "Robotics", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
    ]
    client = _mock_client_with_categories(rows)
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    result = industry_categories.fetch_categories()

    assert [c["id"] for c in result] == ["ai", "robotics"]
    assert result[0]["label"] == "AI"


def test_fetch_categories_empty(monkeypatch):
    client = _mock_client_with_categories([])
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)
    assert industry_categories.fetch_categories() == []


def test_fetch_categories_handles_query_error(monkeypatch):
    """Errors degrade to [] so the caller can fall back without 500-ing."""
    client = MagicMock()
    chain = client.table.return_value.select.return_value
    chain.order.return_value.order.return_value.execute.side_effect = (
        RuntimeError("boom")
    )
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)
    assert industry_categories.fetch_categories() == []


def test_create_category_under_cap(monkeypatch):
    existing = [{"id": f"cat{i}", "label": f"Cat{i}", "is_seed": True} for i in range(5)]
    client = _mock_client_with_categories(existing)
    insert_chain = client.table.return_value.insert
    insert_chain.return_value.execute.return_value = SimpleNamespace(data=[{"id": "newcat"}])
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    ok = industry_categories.create_category_if_under_cap(
        category_id="newcat",
        label="New Category",
        created_by_app_id="00000000-0000-0000-0000-000000000001",
    )

    assert ok is True
    insert_call = insert_chain.call_args[0][0]
    assert insert_call["id"] == "newcat"
    assert insert_call["label"] == "New Category"
    assert insert_call["is_seed"] is False
    assert insert_call["created_by_app_id"] == "00000000-0000-0000-0000-000000000001"


def test_create_category_at_cap_refused(monkeypatch):
    existing = [{"id": f"cat{i}", "label": f"Cat{i}", "is_seed": True} for i in range(12)]
    client = _mock_client_with_categories(existing)
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    ok = industry_categories.create_category_if_under_cap(
        category_id="newcat",
        label="New Category",
        created_by_app_id=None,
    )

    assert ok is False
    client.table.return_value.insert.assert_not_called()


def test_categories_with_counts_payload(monkeypatch):
    """categories_with_counts joins category metadata with ai_screening counts."""
    cats = [
        {"id": "robotics", "label": "Robotics", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
        {"id": "ai", "label": "AI", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
        {"id": "climate", "label": "Climate", "is_seed": False, "created_at": "2026-05-20T00:00:00Z"},
    ]
    # ai_screening projection returns assignments
    assignments = [
        {"industry_category_id": "robotics"},
        {"industry_category_id": "robotics"},
        {"industry_category_id": "robotics"},
        {"industry_category_id": "ai"},
        {"industry_category_id": "ai"},
        {"industry_category_id": "climate"},
    ]

    client = MagicMock()

    def table_router(name: str):
        sub = MagicMock()
        if name == "industry_categories":
            sub.select.return_value.order.return_value.order.return_value.execute.return_value = (
                SimpleNamespace(data=cats)
            )
        elif name == "ai_screening":
            # .select(...).not_.is_(col, "null").limit(N).execute()
            chain = sub.select.return_value
            not_chain = chain.not_
            not_chain.is_.return_value.limit.return_value.execute.return_value = (
                SimpleNamespace(data=assignments)
            )
        return sub

    client.table.side_effect = table_router
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    payload = industry_categories.categories_with_counts()

    assert payload["cap"] == 12
    assert payload["total"] == 6
    # remaining_slots = 12 - 3 categories = 9
    assert payload["remaining_slots"] == 9
    # Sorted desc by count: robotics (3), ai (2), climate (1)
    ids = [c["id"] for c in payload["categories"]]
    assert ids == ["robotics", "ai", "climate"]
    assert payload["categories"][0]["count"] == 3
