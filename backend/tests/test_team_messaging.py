"""Team Connect staff messaging helpers (no Mongo)."""
from team_messaging import MAX_BODY, _dm_key, _public_message, _public_thread


def test_dm_key_is_order_independent():
    assert _dm_key("u-a", "u-b") == _dm_key("u-b", "u-a")
    assert _dm_key("u-a", "u-b").startswith("dm:")


def test_public_thread_marks_membership_and_unread():
    thread = {
        "id": "sth-1",
        "kind": "group",
        "title": "Front desk",
        "memberIds": ["u-1", "u-2"],
        "members": [{"id": "u-1", "name": "A"}, {"id": "u-2", "name": "B"}],
        "createdBy": "u-1",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "updatedAt": "2026-01-01T00:00:00+00:00",
        "lastPreview": "Hello",
    }
    out = _public_thread(thread, "u-2", unread=3)
    assert out["mine"] is True
    assert out["unread"] == 3
    assert out["title"] == "Front desk"
    assert _public_thread(thread, "u-9")["mine"] is False


def test_public_message_defaults_delivered():
    row = {
        "id": "stm-1",
        "threadId": "sth-1",
        "authorId": "u-1",
        "authorName": "A",
        "authorRole": "desk",
        "body": "Hi",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "deliveredAt": "2026-01-01T00:00:00+00:00",
        "readBy": {"u-1": "2026-01-01T00:00:00+00:00"},
    }
    out = _public_message(row)
    assert out["status"] == "delivered"
    assert out["sms"] is False
    assert out["channel"] == "in_app"
    assert MAX_BODY >= 500
