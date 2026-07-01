from app.services import applications_query
import inspect


def test_fetch_ai_screening_selects_all_columns():
    """Leadership AppDrawer reads ai_screening.sections directly, so the
    ai_screening fetch must not drop the new column."""
    src = inspect.getsource(applications_query.fetch_ai_screening_for)
    assert 'select("*")' in src or '"sections"' in src
