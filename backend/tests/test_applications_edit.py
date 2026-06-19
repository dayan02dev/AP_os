from app.models.application import ApplicationRead


def _row():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "00000000-0000-0000-0000-0000000000aa",
        "status": "submitted",
        "completion_pct": 100,
        "submitted_at": "2026-06-04T00:00:00+00:00",
        "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00",
    }


def test_read_model_has_edit_fields_defaulting_off():
    read = ApplicationRead.model_validate(_row())
    assert read.editable is False
    assert read.edit_deadline is None
