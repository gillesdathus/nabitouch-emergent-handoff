"""Quick Help request helpers."""
from assist_requests import ACTIVE, CATEGORIES, STATUSES, default_team_connect_settings, resolve_team_connect


def test_categories_match_brief():
    assert set(CATEGORIES) == {
        "running_late", "vehicle_issue", "safety_concern",
        "address_problem", "need_supplies", "other",
    }
    assert CATEGORIES["safety_concern"]["priority"] == "urgent"
    assert CATEGORIES["running_late"]["priority"] == "routine"
    assert "escalated" in STATUSES
    assert "escalated" in ACTIVE


def test_resolve_team_connect_defaults_and_validation():
    assert resolve_team_connect({}) == default_team_connect_settings()
    cfg = resolve_team_connect({
        "teamConnect": {
            "urgentAckMinutes": 3,
            "routineAckMinutes": 15,
            "dutyPrimaryUserIds": ["u-1"],
            "dutyBackupUserIds": ["u-2"],
        }
    })
    assert cfg["dutyPrimaryUserIds"] == ["u-1"]
    assert cfg["urgentAckMinutes"] == 3
    try:
        resolve_team_connect({"teamConnect": {"urgentAckMinutes": 0}})
        assert False, "expected ValueError"
    except ValueError:
        pass
